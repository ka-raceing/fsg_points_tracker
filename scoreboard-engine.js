(function () {
  "use strict";

  const FSG = window.FSG;
  const CONFIG = FSG.CONFIG;
  const utils = FSG.utils;
  const clamp = utils.clamp;
  const toNumber = utils.toNumber;
  const toPenaltyNumber = utils.toPenaltyNumber;

  class ScoreEngine {
    constructor(liveStore, staticStore) {
      this.liveStore = liveStore;
      this.staticStore = staticStore;
    }

    isRunValid(run, eventCfg) {
      if (run.rawTime === null || run.rawTime <= 0) return false;
      const status = run.status || "";
      const result = run.result || "";
      const badStatus = ["dnf", "disqualified", "dns", "did_not_finish", "did_not_start"];
      const badResult = ["dnf", "disqualified", "no_time", "not_classified"];
      if (badStatus.includes(status)) return false;
      if (badResult.includes(result)) return false;
      if (eventCfg.offCoursePolicy === "dq" && toPenaltyNumber(run.offCourses) > 0) return false;
      return true;
    }

    adjustedTime(run, eventCfg) {
      const base = run.rawTime;
      if (base === null) return null;
      const conePenalty = (eventCfg.conePenaltySec || 0) * toPenaltyNumber(run.cones);
      const offCoursePenalty = eventCfg.offCoursePolicy === "time"
        ? (eventCfg.offCoursePenaltySec || 0) * toPenaltyNumber(run.offCourses)
        : 0;
      return base + conePenalty + offCoursePenalty;
    }

    getDcAutocrossTmax(eventCfg) {
      const lengthM = Number(eventCfg.trackLengthM || 336);
      const speedMps = Number(eventCfg.referenceSpeedMps || 6);
      if (!Number.isFinite(lengthM) || !Number.isFinite(speedMps) || speedMps <= 0) {
        return null;
      }
      return lengthM / speedMps;
    }

    computeDcAutocrossTeamTotal(eventCfg, runs) {
      const tMax = this.getDcAutocrossTmax(eventCfg);
      if (tMax === null) {
        return {
          tMax: null,
          t1: null,
          t2: null,
          total: null,
          run1Number: null,
          run2Number: null,
          usedFallbackOrdering: false
        };
      }

      const sortedRuns = (runs || []).slice().sort((a, b) => {
        const ra = Number.isFinite(Number(a.runNumber)) ? Number(a.runNumber) : Number.POSITIVE_INFINITY;
        const rb = Number.isFinite(Number(b.runNumber)) ? Number(b.runNumber) : Number.POSITIVE_INFINITY;
        if (ra !== rb) return ra - rb;
        const ta = Number(a.timestamp || 0);
        const tb = Number(b.timestamp || 0);
        if (ta !== tb) return ta - tb;
        return String(a.runId || "").localeCompare(String(b.runId || ""), undefined, { numeric: true });
      });

      const explicitRun1 = sortedRuns.find((r) => Number(r.runNumber) === 1) || null;
      const explicitRun2 = sortedRuns.find((r) => Number(r.runNumber) === 2) || null;
      const hasExplicitRunNumbers = sortedRuns.some((r) => Number.isFinite(Number(r.runNumber)) && Number(r.runNumber) > 0);

      let run1 = null;
      let run2 = null;
      let usedFallbackOrdering = false;

      if (hasExplicitRunNumbers) {
        run1 = explicitRun1;
        run2 = explicitRun2;
      } else {
        run1 = sortedRuns[0] || null;
        run2 = sortedRuns.length > 1 ? sortedRuns[1] : null;
        usedFallbackOrdering = true;
      }

      const normalizeRunTime = (run) => {
        if (!run || !this.isRunValid(run, eventCfg)) return tMax;
        const tAdj = this.adjustedTime(run, eventCfg);
        if (tAdj === null || tAdj <= 0) return tMax;
        return Math.min(tAdj, tMax);
      };

      const t1 = normalizeRunTime(run1);
      const t2 = normalizeRunTime(run2);
      const total = Math.min(t1, (t1 + t2) / 2);

      return {
        tMax,
        t1,
        t2,
        total,
        run1Number: run1 ? run1.runNumber : null,
        run2Number: run2 ? run2.runNumber : null,
        usedFallbackOrdering
      };
    }

    baseFormula(maxPoints, tFast, tTeam, tMaxFactor, denominator, exponent, bonusFactor) {
      if (tFast === null || tTeam === null || tTeam <= 0) return 0;
      const tMax = tFast * tMaxFactor;
      const tCapped = Math.min(tTeam, tMax);
      const ratioTerm = Math.pow(tMax / tCapped, exponent);
      const value = (1 - bonusFactor) * maxPoints * ((ratioTerm - 1) / denominator) + bonusFactor * maxPoints;
      return clamp(value, 0, maxPoints);
    }

    getTrackdriveCompletedLaps(eventCfg, eventState, bestRun) {
      const allRuns = eventState && Array.isArray(eventState.allRuns) ? eventState.allRuns : [];
      const fromBestRun = toPenaltyNumber(bestRun ? bestRun.completedLaps : 0);

      let fromRunsCompletedField = 0;
      const distinctLapNumbers = new Set();

      for (const run of allRuns) {
        const completed = toPenaltyNumber(run.completedLaps);
        if (completed > fromRunsCompletedField) {
          fromRunsCompletedField = completed;
        }

        const lap = toNumber(run.lapNumber);
        if (lap !== null && lap > 0) {
          distinctLapNumbers.add(Math.floor(lap));
        }
      }

      const fromDistinctLapNumbers = distinctLapNumbers.size;
      let laps = Math.max(fromBestRun, fromRunsCompletedField, fromDistinctLapNumbers);

      if (eventCfg.targetLaps > 0) {
        laps = Math.min(eventCfg.targetLaps, laps);
      }

      return Math.max(0, Math.floor(laps));
    }

    computeEventPoints(eventCfg, bestRun, fastestRunTime, bestEventTimeAcrossTeams, eventState, auxEventData) {
      if (!bestRun && eventCfg.scoringModel !== "dc_trackdrive") return 0;

      const tTeam = bestRun ? bestRun.adjusted : null;
      const tFast = fastestRunTime;
      let points = 0;

      switch (eventCfg.scoringModel) {
        case "manual_acceleration":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 1.5, 0.5, 1, 0.05);
          break;
        case "manual_skidpad":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 1.25, 0.5625, 2, 0.05);
          break;
        case "manual_autocross":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 1.25, 0.25, 1, 0.05);
          break;
        case "manual_endurance":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 1.333, 0.333, 1, 0.1);
          break;
        case "dc_acceleration":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 2.0, 1, 1, 0.05);
          break;
        case "dc_skidpad":
          points = this.baseFormula(eventCfg.maxPoints, tFast, tTeam, 1.5, 1.25, 2, 0.05);
          break;
        case "dc_trackdrive": {
          let timePart = 0;
          const tMax = tFast === null ? null : tFast * 2.0;
          if (tMax !== null && tTeam !== null && tTeam > 0) {
            const tCapped = Math.min(tTeam, tMax);
            timePart = clamp(0.75 * eventCfg.maxPoints * ((tMax / tCapped) - 1), 0, 0.75 * eventCfg.maxPoints);
          }

          const laps = this.getTrackdriveCompletedLaps(eventCfg, eventState, bestRun);
          const lapPoints = toPenaltyNumber(eventCfg.pointsPerCompletedLap || 5);
          const lapBonus = laps * lapPoints;

          // Trackdrive score is time score plus lap-completion points.
          points = clamp(timePart + lapBonus, 0, eventCfg.maxPoints);
          break;
        }
        case "dc_autocross": {
          const aux = auxEventData || {};
          const tMin = aux.tMin;
          const tMax = aux.tMax;
          const tTeamTotal = aux.tTeamTotal;

          if (tMin === null || tMax === null || tTeamTotal === null) {
            points = 0;
            break;
          }
          const denom = Math.max(tMax - tMin, 1e-9);
          points = clamp((0.9 * eventCfg.maxPoints * (tMax - tTeamTotal) / denom) + (0.1 * eventCfg.maxPoints), 0, eventCfg.maxPoints);
          break;
        }
        default: {
          if (tFast === null || tTeam === null || tTeam <= 0) {
            points = 0;
          } else {
            points = clamp(eventCfg.maxPoints * (tFast / tTeam), 0, eventCfg.maxPoints);
          }
          break;
        }
      }

      if (eventCfg.offCoursePolicy === "points") {
        const ocPenalty = toPenaltyNumber(bestRun ? bestRun.offCourses : 0) * toPenaltyNumber(eventCfg.offCoursePointsPenalty);
        points = clamp(points - ocPenalty, 0, eventCfg.maxPoints);
      }

      return points;
    }

    getPenaltyPoints(rawScore) {
      const value = Number(rawScore || 0);
      if (!Number.isFinite(value)) return 0;
      return Math.min(0, value);
    }

    buildCompetition(cupKey) {
      const cupCfg = CONFIG.competitions[cupKey];
      const carIds = this.liveStore.getAllCarIds();

      const rows = carIds.map((carId) => {
        const team = this.liveStore.teams.get(carId) || {
          name: "Car " + carId,
          university: "",
          country: "",
          fsClass: ""
        };

        const dynamic = {};
        for (const eventCfg of cupCfg.dynamicEvents) {
          const runs = this.liveStore.getEnrichedRunsForEvent(eventCfg.source, carId);
          const valid = runs
            .filter((run) => this.isRunValid(run, eventCfg))
            .map((run) => ({ ...run, adjusted: this.adjustedTime(run, eventCfg) }))
            .filter((run) => run.adjusted !== null)
            .sort((a, b) => a.adjusted - b.adjusted);

          dynamic[eventCfg.key] = {
            best: valid.length > 0 ? valid[0] : null,
            runCount: runs.length,
            allRuns: runs,
            validRuns: valid
          };
        }

        return {
          carId,
          team,
          dynamic,
          staticScores: this.staticStore.get(cupKey, carId)
        };
      });

      const fastestByEvent = {};
      const bestAdjustedByEvent = {};
      const auxByEventByCar = {};
      for (const eventCfg of cupCfg.dynamicEvents) {
        let fastest = null;
        for (const row of rows) {
          const best = row.dynamic[eventCfg.key].best;
          if (!best) continue;
          if (fastest === null || best.adjusted < fastest) fastest = best.adjusted;
        }
        fastestByEvent[eventCfg.key] = fastest;
        bestAdjustedByEvent[eventCfg.key] = fastest;

        if (eventCfg.scoringModel === "dc_autocross") {
          auxByEventByCar[eventCfg.key] = {};
          const totals = [];
          let sharedTMax = this.getDcAutocrossTmax(eventCfg);

          for (const row of rows) {
            const eventState = row.dynamic[eventCfg.key];
            const calc = this.computeDcAutocrossTeamTotal(eventCfg, eventState ? eventState.allRuns : []);
            auxByEventByCar[eventCfg.key][row.carId] = calc;
            if (calc.total !== null) totals.push(calc.total);
            if (calc.tMax !== null) sharedTMax = calc.tMax;
          }

          const tMin = totals.length > 0 ? Math.min(...totals) : null;
          for (const row of rows) {
            const calc = auxByEventByCar[eventCfg.key][row.carId] || { tMax: sharedTMax, total: null, t1: null, t2: null };
            auxByEventByCar[eventCfg.key][row.carId] = {
              ...calc,
              tMax: sharedTMax,
              tMin: tMin,
              tTeamTotal: calc.total
            };
          }

          fastestByEvent[eventCfg.key] = tMin;
          bestAdjustedByEvent[eventCfg.key] = tMin;
        }
      }

      for (const row of rows) {
        row.dynamicTotal = 0;
        row.dynamicPoints = {};
        row.dynamicAux = {};

        for (const eventCfg of cupCfg.dynamicEvents) {
          const best = row.dynamic[eventCfg.key].best;
          const fastest = fastestByEvent[eventCfg.key];
          const eventState = row.dynamic[eventCfg.key];
          const auxEventData = auxByEventByCar[eventCfg.key]
            ? auxByEventByCar[eventCfg.key][row.carId]
            : null;
          const pts = this.computeEventPoints(
            eventCfg,
            best,
            fastest,
            bestAdjustedByEvent[eventCfg.key],
            eventState,
            auxEventData
          );
          row.dynamicPoints[eventCfg.key] = pts;
          row.dynamicAux[eventCfg.key] = auxEventData;
          row.dynamicTotal += pts;
        }

        row.staticTotal = 0;
        row.staticByKey = {};
        for (const staticEvent of cupCfg.staticEvents) {
          const v = Number(row.staticScores[staticEvent.key] || 0);
          const clamped = clamp(v, 0, staticEvent.maxPoints);
          row.staticByKey[staticEvent.key] = clamped;
          row.staticTotal += clamped;
        }

        row.penaltyTotal = 0;
        row.penaltyByKey = {};
        for (const penaltyEvent of (cupCfg.penaltyEvents || [])) {
          const v = this.getPenaltyPoints(row.staticScores[penaltyEvent.key]);
          const clamped = clamp(v, penaltyEvent.minPoints, penaltyEvent.maxPoints);
          row.penaltyByKey[penaltyEvent.key] = clamped;
          row.penaltyTotal += clamped;
        }

        row.total = row.dynamicTotal + row.staticTotal + row.penaltyTotal;
      }

      rows.sort((a, b) => b.total - a.total);
      rows.forEach((row, index) => {
        row.rank = index + 1;
      });

      return {
        cupKey,
        label: cupCfg.label,
        config: cupCfg,
        rows,
        fastestByEvent
      };
    }
  }

  window.FSG = window.FSG || {};
  window.FSG.ScoreEngine = ScoreEngine;
})();
