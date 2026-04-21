(function () {
  "use strict";

  const FSG = window.FSG;
  const ui = FSG.ui;
  const pageCup = FSG.pageCup;
  const utils = FSG.utils;
  const fmtTime = utils.fmtTime;
  const fmtTimePrecise = utils.fmtTimePrecise;
  const fmtPoints = utils.fmtPoints;

  class Renderer {
    constructor(liveStore, staticStore, engine) {
      this.liveStore = liveStore;
      this.staticStore = staticStore;
      this.engine = engine;
    }

    render() {
      this.renderStatus();
      this.renderBoard(pageCup, ui.board);
      this.renderDebugStats();
    }

    renderStatus() {
      const summary = this.liveStore.getStateSummary();
      if (this.liveStore.connected) {
        ui.connectionBadge.className = "badge status-ok";
        ui.connectionBadge.textContent = "Live";
      } else {
        ui.connectionBadge.className = "badge status-bad";
        ui.connectionBadge.textContent = "Offline";
      }

      ui.updateBadge.textContent = summary.lastUpdate
        ? "Last update " + summary.lastUpdate.toLocaleTimeString()
        : "No message yet";
    }

    renderDebugStats() {
      const summary = this.liveStore.getStateSummary();
      ui.msgCountChip.textContent = "Messages: " + summary.messageCount;
      ui.teamCountChip.textContent = "Teams: " + summary.teamCount;
      ui.runCountChip.textContent = "Runs: " + summary.runCount;
      if (ui.trackdriveLapsChip) {
        ui.trackdriveLapsChip.textContent = this.buildTrackdriveDebugText(pageCup);
      }
    }

    buildTrackdriveDebugText(cupKey) {
      const cupCfg = FSG.CONFIG.competitions[cupKey];
      if (!cupCfg) return "Trackdrive laps: n/a";

      const trackdriveCfg = cupCfg.dynamicEvents.find((eventCfg) => eventCfg.scoringModel === "dc_trackdrive");
      if (!trackdriveCfg) return "Trackdrive laps: n/a";

      const carIds = this.liveStore.getAllCarIds();
      let totalCompletedLaps = 0;
      let teamsWithTrackdriveRuns = 0;
      const perTeamLaps = [];

      for (const carId of carIds) {
        const runs = this.liveStore.getEnrichedRunsForEvent(trackdriveCfg.source, carId);
        if (runs.length === 0) continue;
        teamsWithTrackdriveRuns += 1;

        const validBest = runs
          .filter((run) => this.engine.isRunValid(run, trackdriveCfg))
          .map((run) => ({ ...run, adjusted: this.engine.adjustedTime(run, trackdriveCfg) }))
          .filter((run) => run.adjusted !== null)
          .sort((a, b) => a.adjusted - b.adjusted)[0] || null;

        const laps = this.engine.getTrackdriveCompletedLaps(trackdriveCfg, { allRuns: runs }, validBest);
        totalCompletedLaps += laps;
        perTeamLaps.push("#" + carId + ":" + laps);
      }

      if (perTeamLaps.length === 0) {
        return "Trackdrive laps: 0 (teams: 0)";
      }

      return "Trackdrive laps: " + totalCompletedLaps + " (teams: " + teamsWithTrackdriveRuns + ") [" + perTeamLaps.join(", ") + "]";
    }

    renderBoard(cupKey, mountEl) {
      const board = this.engine.buildCompetition(cupKey);
      const nAll = Number(board.nAll || 0);
      const nAllByEvent = board.nAllByEvent || {};
      const evRankModeEventKeys = cupKey === "EV"
        ? new Set(["autonomous_skidpad", "autonomous_acceleration"])
        : new Set();

      const rankInfoByEvent = {};
      for (const eventCfg of board.config.dynamicEvents) {
        if (!evRankModeEventKeys.has(eventCfg.key)) continue;
        const rankedRows = board.rows
          .filter((row) => row.dynamic[eventCfg.key] && row.dynamic[eventCfg.key].best)
          .slice()
          .sort((a, b) => a.dynamic[eventCfg.key].best.adjusted - b.dynamic[eventCfg.key].best.adjusted);

        const rankByCarId = new Map();
        rankedRows.forEach((row, index) => {
          rankByCarId.set(row.carId, index + 1);
        });

        rankInfoByEvent[eventCfg.key] = {
          rankByCarId,
          rankedCount: rankedRows.length,
          totalTeams: board.rows.length,
          nAll: Number(nAllByEvent[eventCfg.key] || nAll)
        };
      }

      const dynamicHeaders = board.config.dynamicEvents.map((eventCfg) => {
        return "<th>" + eventCfg.label + "<br><span class=\"muted\">/" + eventCfg.maxPoints + "</span></th>";
      }).join("");

      const staticHeaders = board.config.staticEvents.map((eventCfg) => {
        return "<th>" + eventCfg.label + "<br><span class=\"muted\">/" + eventCfg.maxPoints + "</span></th>";
      }).join("");

      const penaltyHeaders = (board.config.penaltyEvents || []).map((eventCfg) => {
        return "<th>" + eventCfg.label + "<br><span class=\"muted\">" + eventCfg.minPoints + ".." + eventCfg.maxPoints + "</span></th>";
      }).join("");

      const rowsHtml = board.rows.map((row) => {
        const dynamicCells = board.config.dynamicEvents.map((eventCfg) => {
          const best = row.dynamic[eventCfg.key].best;
          const pts = row.dynamicPoints[eventCfg.key];
          const aux = row.dynamicAux ? row.dynamicAux[eventCfg.key] : null;
          const fastest = board.fastestByEvent[eventCfg.key];
          const isFast = best && fastest !== null && Math.abs(best.adjusted - fastest) < 1e-9;
          const showRankMode = evRankModeEventKeys.has(eventCfg.key);
          const rankInfo = rankInfoByEvent[eventCfg.key] || null;
          const rank = rankInfo ? rankInfo.rankByCarId.get(row.carId) : null;
          const eventState = row.dynamic[eventCfg.key];

          const trackdriveMeta = (() => {
            if (eventCfg.scoringModel !== "dc_trackdrive") return null;
            const laps = this.engine.getTrackdriveCompletedLaps(eventCfg, eventState, best);
            const lapPointsPerLap = Number(eventCfg.pointsPerCompletedLap || 5);
            const lapBonus = laps * lapPointsPerLap;
            return { laps, lapBonus };
          })();

          if (!best) {
            if (eventCfg.scoringModel === "dc_trackdrive" && pts > 0) {
              const laps = trackdriveMeta ? trackdriveMeta.laps : 0;
              const lapBonus = trackdriveMeta ? trackdriveMeta.lapBonus : 0;
              return "<td class=\"event-cell\"><span class=\"num\">" + fmtPoints(pts) + "</span> <span class=\"muted\">(lap points only, no valid time; laps=" + laps + ", lap bonus=" + fmtPoints(lapBonus) + ")</span><span class=\"live\">LIVE</span></td>";
            }
            return "<td class=\"event-cell\"><span class=\"muted\">No valid time</span></td>";
          }

          const penaltyText = " +" + best.cones + "c +" + best.offCourses + "oc";
          const speedLine =
            "<span class=\"num\">" + fmtPoints(pts) + "</span> " +
            "<span class=\"muted\">(" + fmtTime(best.rawTime) + penaltyText + " => " + fmtTime(best.adjusted) + "; precise " + fmtTimePrecise(best.adjusted) + ")</span>";

          let runSlotInfo = "";
          if (eventCfg.scoringModel === "dc_autocross" && aux) {
            const r1Label = aux.run1Number === null || aux.run1Number === undefined ? "missing" : String(aux.run1Number);
            const r2Label = aux.run2Number === null || aux.run2Number === undefined ? "missing" : String(aux.run2Number);
            const modeLabel = aux.usedFallbackOrdering ? "fallback order" : "explicit run slots";
            runSlotInfo = " <span class=\"muted\">[R1=" + r1Label + ", R2=" + r2Label + ", " + modeLabel + "]</span>";
          } else if (eventCfg.scoringModel === "dc_trackdrive" && trackdriveMeta) {
            runSlotInfo = " <span class=\"muted\">[laps=" + trackdriveMeta.laps + ", lap bonus=" + fmtPoints(trackdriveMeta.lapBonus) + "]</span>";
          }

          return "<td class=\"event-cell\">" +
            (showRankMode
              ? (rank ? "<span class=\"muted\">Rank " + rank + "/" + rankInfo.nAll + " (Nall)</span>" : "")
              : (isFast ? "<span class=\"fastest\">Fastest</span>" : "")) +
            speedLine +
            runSlotInfo +
            "<span class=\"live\">LIVE</span>" +
            "</td>";
        }).join("");

        const staticCells = board.config.staticEvents.map((eventCfg) => {
          const current = row.staticByKey[eventCfg.key] || 0;
          return "<td class=\"num\">" +
            "<input " +
            "type=\"number\" step=\"1\" min=\"0\" max=\"" + eventCfg.maxPoints + "\" " +
            "value=\"" + current + "\" " +
            "data-cup=\"" + cupKey + "\" " +
            "data-carid=\"" + row.carId + "\" " +
            "data-field=\"" + eventCfg.key + "\" " +
            "class=\"static-input\" />" +
            "</td>";
        }).join("");

        const penaltyCells = (board.config.penaltyEvents || []).map((eventCfg) => {
          const current = row.penaltyByKey[eventCfg.key] || 0;
          return "<td class=\"num\">" +
            "<input " +
            "type=\"number\" step=\"1\" min=\"" + eventCfg.minPoints + "\" max=\"" + eventCfg.maxPoints + "\" " +
            "value=\"" + current + "\" " +
            "data-cup=\"" + cupKey + "\" " +
            "data-carid=\"" + row.carId + "\" " +
            "data-field=\"" + eventCfg.key + "\" " +
            "class=\"static-input\" />" +
            "</td>";
        }).join("");

        const teamMeta = [row.team.university, row.team.country].filter(Boolean).join(" ");
        const fsClassPart = row.team.fsClass ? " [" + row.team.fsClass + "]" : "";

        return "<tr>" +
          "<td class=\"rank\">" + row.rank + "</td>" +
          "<td>" +
            "<div class=\"name-line\">" + row.team.name + "</div>" +
            "<div class=\"meta-line\">#" + row.carId + " " + teamMeta + fsClassPart + "</div>" +
          "</td>" +
          dynamicCells +
          staticCells +
            penaltyCells +
          "<td class=\"num\">" + fmtPoints(row.dynamicTotal) + "</td>" +
          "<td class=\"num\">" + fmtPoints(row.staticTotal) + "</td>" +
            "<td class=\"num\">" + fmtPoints(row.penaltyTotal) + "</td>" +
          "<td class=\"num\"><strong>" + fmtPoints(row.total) + "</strong></td>" +
          "</tr>";
      }).join("");

      const fastestChips = board.config.dynamicEvents.map((eventCfg) => {
        if (evRankModeEventKeys.has(eventCfg.key)) {
          const rankInfo = rankInfoByEvent[eventCfg.key];
          const rankedCount = rankInfo ? rankInfo.rankedCount : 0;
          const nAllValue = rankInfo ? rankInfo.nAll : nAll;
          return "<span class=\"chip\">" + eventCfg.label + " ranking: " + rankedCount + "/" + nAllValue + " (Nall)</span>";
        }
        const f = board.fastestByEvent[eventCfg.key];
        return "<span class=\"chip\">" + eventCfg.label + " fastest: " + (f === null ? "none" : fmtTime(f)) + "</span>";
      }).join("");

      mountEl.innerHTML =
        "<div class=\"scoreboard-title\">" +
          "<h2>" + board.label + "</h2>" +
          "<span class=\"badge\">Rules-based scoring active</span>" +
        "</div>" +
        "<div class=\"chips\">" + fastestChips + "</div>" +
        "<div class=\"table-wrap\">" +
          "<table>" +
            "<thead>" +
              "<tr>" +
                "<th class=\"rank\">#</th>" +
                "<th>Team</th>" +
                dynamicHeaders +
                staticHeaders +
                penaltyHeaders +
                "<th>Dynamic</th>" +
                "<th>Static</th>" +
                "<th>Penalties</th>" +
                "<th>Total</th>" +
              "</tr>" +
            "</thead>" +
            "<tbody>" + rowsHtml + "</tbody>" +
          "</table>" +
        "</div>";
    }
  }

  window.FSG = window.FSG || {};
  window.FSG.Renderer = Renderer;
})();
