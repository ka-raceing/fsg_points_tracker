(function () {
  "use strict";

  const FSG = window.FSG;
  const STORAGE_KEYS = FSG.STORAGE_KEYS;
  const CONFIG = FSG.CONFIG;
  const utils = FSG.utils;
  const toNumber = utils.toNumber;
  const toPenaltyNumber = utils.toPenaltyNumber;
  const normId = utils.normId;

  class StaticPointsStore {
    constructor(logger) {
      this.logger = logger;
      this.ev = this.readStorage(STORAGE_KEYS.ev);
      this.dv = this.readStorage(STORAGE_KEYS.dv);
    }

    readStorage(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      } catch (error) {
        this.logger.write("WARN", "Failed to parse localStorage", { key, error: String(error) });
        return {};
      }
    }

    save() {
      localStorage.setItem(STORAGE_KEYS.ev, JSON.stringify(this.ev));
      localStorage.setItem(STORAGE_KEYS.dv, JSON.stringify(this.dv));
    }

    get(cup, carId) {
      const id = normId(carId);
      if (cup === "DV") return this.dv[id] || { engineering_design: 0, penalties: 0 };
      return this.ev[id] || {
        engineering_design: 0,
        cost_manufacturing: 0,
        business_plan: 0,
        efficiency: 0,
        penalties: 0
      };
    }

    set(cup, carId, field, value) {
      const target = cup === "DV" ? this.dv : this.ev;
      const id = normId(carId);
      if (!id) return;
      if (!target[id]) target[id] = {};
      target[id][field] = value;
      this.save();
    }

    mergeRow(target, carId, row, overwrite) {
      if (!target[carId]) {
        target[carId] = {};
      }

      for (const [key, value] of Object.entries(row)) {
        target[carId][key] = value;
      }
    }

    importText(cup, text, kind, overwrite) {
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      let imported = 0;
      const target = cup === "DV" ? this.dv : this.ev;

      for (const line of lines) {
        if (line.startsWith("#")) continue;
        const cols = line.split(/[,;\t]+/).map((x) => x.trim());
        if (cols.length < 2) continue;
        if (/car/i.test(cols[0])) continue;

        const carId = normId(cols[0]);
        if (!carId) continue;

        if (kind === "penalties") {
          const penaltyValue = toNumber(cols[1]);
          const penalties = penaltyValue === null ? 0 : (penaltyValue > 0 ? -penaltyValue : penaltyValue);
          this.mergeRow(target, carId, { penalties }, overwrite);
          imported += 1;
        } else if (cup === "DV") {
          const engineeringDesign = toNumber(cols[1]);
          this.mergeRow(target, carId, {
            engineering_design: engineeringDesign === null ? 0 : engineeringDesign
          }, overwrite);
          imported += 1;
        } else {
          const engineeringDesign = toNumber(cols[1]);
          const costManufacturing = toNumber(cols[2]);
          const businessPlan = toNumber(cols[3]);
          const efficiency = toNumber(cols[4]);
          this.mergeRow(target, carId, {
            engineering_design: engineeringDesign === null ? 0 : engineeringDesign,
            cost_manufacturing: costManufacturing === null ? 0 : costManufacturing,
            business_plan: businessPlan === null ? 0 : businessPlan,
            efficiency: efficiency === null ? 0 : efficiency
          }, overwrite);
          imported += 1;
        }
      }

      this.save();
      this.logger.write("INFO", "Static points imported", { cup, imported });
      return imported;
    }

    async loadBaseFile(cup, kind, fileName) {
      if (!fileName) return 0;

      try {
        const response = await fetch(fileName, { cache: "no-store" });
        if (!response.ok) {
          this.logger.write("WARN", "Base CSV not available", { cup, kind, fileName, status: response.status });
          return 0;
        }

        const text = await response.text();
        return this.importText(cup, text, kind, false);
      } catch (error) {
        this.logger.write("WARN", "Failed to load base CSV", { cup, kind, fileName, error: String(error) });
        return 0;
      }
    }

    async loadBaseData(cup) {
      const cupCfg = CONFIG.competitions[cup];
      if (!cupCfg || !cupCfg.dataFiles) return;

      await this.loadBaseFile(cup, "static", cupCfg.dataFiles.static);
      await this.loadBaseFile(cup, "penalties", cupCfg.dataFiles.penalties);
    }
  }

  class LiveTimingStore {
    constructor(logger) {
      this.logger = logger;
      this.teams = new Map();
      this.timekeepingByEvent = new Map();
      this.csdByEventRun = new Map();
      this.messageCount = 0;
      this.client = null;
      this.connected = false;
      this.lastUpdate = null;
      this.onUpdate = null;
    }

    async connect() {
      if (typeof mqtt === "undefined") {
        this.logger.write("ERROR", "mqtt.js is not available.");
        this.setConnection(false);
        return;
      }

      if (this.client) {
        try { this.client.end(true); } catch (error) {}
      }

      this.client = mqtt.connect(CONFIG.brokerUrl, {
        protocolVersion: 5,
        reconnectPeriod: CONFIG.reconnectMs,
        connectTimeout: 20000
      });

      this.client.on("connect", () => {
        this.setConnection(true);
        this.logger.write("INFO", "Connected to MQTT broker", { url: CONFIG.brokerUrl });
        this.subscribeAll();
      });

      this.client.on("close", () => {
        this.setConnection(false);
        this.logger.write("WARN", "MQTT connection closed");
      });

      this.client.on("error", (error) => {
        this.setConnection(false);
        this.logger.write("ERROR", "MQTT error", { error: String(error) });
      });

      this.client.on("message", (topic, payloadBuffer) => {
        this.handleMessage(topic, payloadBuffer);
      });
    }

    subscribeAll() {
      for (const topic of CONFIG.topics) {
        this.client.subscribe(topic, (error) => {
          if (error) {
            this.logger.write("ERROR", "Subscribe failed", { topic, error: String(error) });
          } else {
            this.logger.write("INFO", "Subscribed", { topic });
          }
        });
      }
    }

    setConnection(isConnected) {
      this.connected = isConnected;
      if (this.onUpdate) this.onUpdate();
    }

    extractRuns(payload) {
      if (!payload) return [];
      if (Array.isArray(payload.runs)) return payload.runs;
      if (payload.data && Array.isArray(payload.data.runs)) return payload.data.runs;
      if (Array.isArray(payload)) return payload;
      return [];
    }

    extractCsdItems(payload) {
      if (!payload) return [];
      if (Array.isArray(payload)) return payload;
      if (Array.isArray(payload.runs)) return payload.runs;
      if (payload.data && Array.isArray(payload.data.runs)) return payload.data.runs;
      if (payload.data && Array.isArray(payload.data)) return payload.data;
      return [payload];
    }

    parseLapValue(value) {
      if (value === null || value === undefined) return null;

      if (typeof value === "number") {
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.floor(value);
      }

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const direct = Number(trimmed);
        if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
        const match = trimmed.match(/(\d+)/);
        if (match) return Math.floor(Number(match[1]));
        return null;
      }

      if (Array.isArray(value)) {
        return value.length;
      }

      if (typeof value === "object") {
        const objectCandidates = [
          value.completed,
          value.current,
          value.count,
          value.value,
          value.laps,
          value.finished,
          value.done,
          value.completed_laps,
          value.completedLaps
        ];
        for (const candidate of objectCandidates) {
          const parsed = this.parseLapValue(candidate);
          if (parsed !== null) return parsed;
        }
      }

      return null;
    }

    extractCompletedLaps(run, lapNumber) {
      const candidates = [
        run.completed_laps,
        run.laps_completed,
        run.laps,
        run.lap_count,
        run.lapCount,
        run.number_of_laps,
        run.completed_lap_count,
        run.completedLapCount,
        run.finished_laps,
        run.finishedLaps,
        run.laps_done,
        run.lapsDone,
        run.lap_progress,
        run.lapProgress
      ];

      let best = null;
      for (const candidate of candidates) {
        const parsed = this.parseLapValue(candidate);
        if (parsed !== null) {
          best = best === null ? parsed : Math.max(best, parsed);
        }
      }

      const parsedLapNumber = this.parseLapValue(lapNumber);
      if (parsedLapNumber !== null) {
        best = best === null ? parsedLapNumber : Math.max(best, parsedLapNumber);
      }

      return best === null ? 0 : best;
    }

    normalizeRun(run, eventSource) {
      const runId = normId(run.run_id ?? run.id);
      const carIdRaw = run.car_id ?? run.carId ?? run.team_id ?? run.teamId;
      if (carIdRaw === null || carIdRaw === undefined) return null;
      const carId = normId(carIdRaw);
      const runNumber = toNumber(
        run.run_number ??
        run.runNumber ??
        run.run_no ??
        run.runNo ??
        run.attempt ??
        run.try_number ??
        run.tryNumber
      );

      let rawTime = toNumber(run.time ?? run.best_time ?? run.final_time);
      if (rawTime === null) {
        const duration = toNumber(run.duration);
        if (duration !== null) {
          rawTime = duration > 10000 ? duration / 1000000 : duration;
        }
      }

      const status = String(run.status ?? "").toLowerCase();
      const result = String(run.result ?? "").toLowerCase();
      const lapNumber = toNumber(run.lap ?? run.lap_number ?? run.lapNumber ?? run.current_lap ?? run.currentLap);
      const completedLaps = this.extractCompletedLaps(run, lapNumber);

      const modeText = String(
        run.mode ??
        run.run_mode ??
        run.driving_mode ??
        run.vehicle_mode ??
        run.operation_mode ??
        ""
      ).toLowerCase();

      const autonomousRaw = run.is_autonomous ?? run.isAutonomous ?? run.autonomous ?? run.driverless;
      const isAutonomous = autonomousRaw === true || String(autonomousRaw).toLowerCase() === "true";

      return {
        runId,
        carId,
        sourceEvent: eventSource,
        runNumber,
        rawTime,
        status,
        result,
        lapNumber,
        cones: toPenaltyNumber(run.cones ?? run.c ?? run.cone_count),
        offCourses: toPenaltyNumber(run.off_courses ?? run.offCourses ?? run.oc),
        completedLaps,
        modeText,
        isAutonomous,
        timestamp: run.timestamp || Date.now()
      };
    }

    handleMessage(topic, payloadBuffer) {
      this.messageCount += 1;
      this.lastUpdate = new Date();
      let payload;

      try {
        payload = JSON.parse(payloadBuffer.toString("utf8"));
      } catch (error) {
        this.logger.write("ERROR", "Invalid JSON payload", { topic, error: String(error) });
        if (this.onUpdate) this.onUpdate();
        return;
      }

      if (topic === "timekeeping/default/results/full") {
        this.processTeamSnapshot(payload);
      } else if (topic.startsWith("timekeeping/") && topic.endsWith("/results/full")) {
        this.processTimekeepingSnapshot(topic, payload);
      } else if (topic.startsWith("csd/") && topic.endsWith("/full")) {
        this.processCsdMessage(topic, payload);
      }

      if (this.onUpdate) this.onUpdate();
    }

    processTeamSnapshot(payload) {
      const teams = Array.isArray(payload.teams)
        ? payload.teams
        : (payload.data && Array.isArray(payload.data.teams) ? payload.data.teams : []);

      for (const team of teams) {
        const carIdRaw = team.car_id ?? team.carId;
        if (carIdRaw === null || carIdRaw === undefined) continue;
        const carId = normId(carIdRaw);
        this.teams.set(carId, {
          name: team.name || "Unknown Team",
          university: team.university || "",
          country: team.country_code || "",
          fsClass: team.fs_class || ""
        });
      }

      this.logger.write("INFO", "Team snapshot received", { teams: teams.length });
    }

    processTimekeepingSnapshot(topic, payload) {
      const sourceEvent = topic.split("/")[1];
      const runs = this.extractRuns(payload)
        .map((run) => this.normalizeRun(run, sourceEvent))
        .filter(Boolean);

      this.timekeepingByEvent.set(sourceEvent, runs);
      this.logger.write("INFO", "Timekeeping snapshot", { sourceEvent, runs: runs.length });
    }

    processCsdMessage(topic, payload) {
      const sourceEvent = topic.split("/")[1];
      const items = this.extractCsdItems(payload);

      if (!this.csdByEventRun.has(sourceEvent)) {
        this.csdByEventRun.set(sourceEvent, new Map());
      }

      const map = this.csdByEventRun.get(sourceEvent);

      for (const item of items) {
        const runId = normId(item.run_id ?? item.runId ?? item.id);
        if (!runId) continue;
        map.set(runId, {
          cones: toPenaltyNumber(item.cones ?? item.c ?? item.cone_count),
          offCourses: toPenaltyNumber(item.off_courses ?? item.offCourses ?? item.oc),
          judgeScore: toPenaltyNumber(item.judge_score)
        });
      }
    }

    getAllCarIds() {
      const fromTeams = Array.from(this.teams.keys());
      const fromRuns = [];

      for (const runs of this.timekeepingByEvent.values()) {
        for (const run of runs) {
          fromRuns.push(run.carId);
        }
      }

      return Array.from(new Set(fromTeams.concat(fromRuns))).sort((a, b) => {
        const na = Number(a);
        const nb = Number(b);
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
        return a.localeCompare(b);
      });
    }

    getEnrichedRunsForEvent(sourceEvent, carId) {
      const runs = this.timekeepingByEvent.get(sourceEvent) || [];
      const csdMap = this.csdByEventRun.get(sourceEvent) || new Map();
      const forCar = runs.filter((r) => r.carId === carId);

      return forCar.map((run) => {
        const csd = run.runId ? (csdMap.get(run.runId) || null) : null;
        return {
          ...run,
          cones: csd ? csd.cones : run.cones,
          offCourses: csd ? csd.offCourses : run.offCourses,
          judgeScore: csd ? csd.judgeScore : 0
        };
      });
    }

    getStateSummary() {
      let runCount = 0;
      for (const runs of this.timekeepingByEvent.values()) {
        runCount += runs.length;
      }
      return {
        messageCount: this.messageCount,
        teamCount: this.teams.size,
        runCount: runCount,
        lastUpdate: this.lastUpdate
      };
    }
  }

  window.FSG = window.FSG || {};
  window.FSG.StaticPointsStore = StaticPointsStore;
  window.FSG.LiveTimingStore = LiveTimingStore;
})();
