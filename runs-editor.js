(function () {
  "use strict";

  const FSG = window.FSG;
  const utils = FSG.utils;
  const toNumber = utils.toNumber;
  const toPenaltyNumber = utils.toPenaltyNumber;

  function getUi() {
    return {
      connectionBadge: document.getElementById("connectionBadge"),
      updateBadge: document.getElementById("updateBadge"),
      msgCountChip: document.getElementById("msgCountChip"),
      teamCountChip: document.getElementById("teamCountChip"),
      runCountChip: document.getElementById("runCountChip"),
      trackdriveLapsChip: document.getElementById("trackdriveLapsChip"),
      debugLog: document.getElementById("debugLog"),
      reconnectBtn: document.getElementById("reconnectBtn"),
      clearDebugBtn: document.getElementById("clearDebugBtn"),
      clearRunOverridesBtn: document.getElementById("clearRunOverridesBtn"),
      runFilterInput: document.getElementById("runFilterInput"),
      runsBoard: document.getElementById("runsBoard")
    };
  }

  function normalizeTimestamp(value) {
    const n = toNumber(value);
    if (n === null) return "-";
    return new Date(n).toLocaleString();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildEventLabelMap() {
    const labels = {};
    for (const cupCfg of Object.values(FSG.CONFIG.competitions)) {
      for (const eventCfg of cupCfg.dynamicEvents) {
        labels[eventCfg.source] = eventCfg.label;
      }
    }
    return labels;
  }

  function createApp() {
    const ui = getUi();
    const logger = new FSG.utils.DebugLog(ui.debugLog);
    const liveStore = new FSG.LiveTimingStore(logger);
    const eventLabelBySource = buildEventLabelMap();
    let filterText = "";

    // Keep the runs table in sync with incoming MQTT snapshots.
    liveStore.onUpdate = () => render();

    function renderStatus() {
      const summary = liveStore.getStateSummary();
      if (liveStore.connected) {
        ui.connectionBadge.className = "badge status-ok";
        ui.connectionBadge.textContent = "Live";
      } else {
        ui.connectionBadge.className = "badge status-bad";
        ui.connectionBadge.textContent = "Offline";
      }

      ui.updateBadge.textContent = summary.lastUpdate
        ? "Last update " + summary.lastUpdate.toLocaleTimeString()
        : "No message yet";

      ui.msgCountChip.textContent = "Messages: " + summary.messageCount;
      ui.teamCountChip.textContent = "Teams: " + summary.teamCount;
      ui.runCountChip.textContent = "Runs: " + summary.runCount;
      ui.trackdriveLapsChip.textContent = "Run overrides: " + Object.keys(liveStore.runOverrides || {}).length;
    }

    function runMatchesFilter(run, teamName) {
      if (!filterText) return true;
      const hay = [
        run.carId,
        run.sourceEvent,
        eventLabelBySource[run.sourceEvent] || "",
        run.runId,
        teamName,
        run.status,
        run.result
      ].join(" ").toLowerCase();
      return hay.includes(filterText);
    }

    function renderRunsBoard() {
      const allRuns = liveStore.getAllEnrichedRuns().slice().reverse();
      const rows = allRuns.filter((run) => {
        const team = liveStore.teams.get(run.carId);
        const teamName = team ? team.name : "";
        return runMatchesFilter(run, teamName);
      });

      if (rows.length === 0) {
        ui.runsBoard.innerHTML = "<div class=\"muted\">No runs received yet. Waiting for MQTT snapshots...</div>";
        return;
      }

      const bodyHtml = rows.map((run) => {
        const team = liveStore.teams.get(run.carId) || { name: "Unknown Team" };
        const eventLabel = eventLabelBySource[run.sourceEvent] || run.sourceEvent;
        const runNum = run.runNumber === null || run.runNumber === undefined ? "" : String(run.runNumber);
        const lapNum = run.lapNumber === null || run.lapNumber === undefined ? "" : String(run.lapNumber);
        const rawTime = run.rawTime === null || run.rawTime === undefined ? "" : String(run.rawTime);
        const overrideActive = !!liveStore.getRunOverride(run.sourceEvent, run.runId);

        return "<tr>" +
          "<td class=\"num\">" + escapeHtml(run.carId) + "</td>" +
          "<td><div class=\"name-line\">" + escapeHtml(team.name) + "</div></td>" +
          "<td><div class=\"name-line\">" + escapeHtml(eventLabel) + "</div><div class=\"meta-line\">" + escapeHtml(run.sourceEvent) + "</div></td>" +
          "<td><div class=\"meta-line\">" + escapeHtml(run.runId) + "</div></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"1\" min=\"0\" value=\"" + escapeHtml(runNum) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"runNumber\" /></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"0.001\" min=\"0\" value=\"" + escapeHtml(rawTime) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"rawTime\" /></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"1\" min=\"0\" value=\"" + escapeHtml(run.cones) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"cones\" /></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"1\" min=\"0\" value=\"" + escapeHtml(run.offCourses) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"offCourses\" /></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"1\" min=\"0\" value=\"" + escapeHtml(lapNum) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"lapNumber\" /></td>" +
          "<td class=\"num\"><input type=\"number\" step=\"1\" min=\"0\" value=\"" + escapeHtml(run.completedLaps) + "\" class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"completedLaps\" /></td>" +
          "<td><input type=\"text\" value=\"" + escapeHtml(run.status || "") + "\" class=\"run-input run-input-text\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"status\" /></td>" +
          "<td><input type=\"text\" value=\"" + escapeHtml(run.result || "") + "\" class=\"run-input run-input-text\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"result\" /></td>" +
          "<td><input type=\"text\" value=\"" + escapeHtml(run.modeText || "") + "\" class=\"run-input run-input-text\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"modeText\" /></td>" +
          "<td><select class=\"run-input\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\" data-field=\"isAutonomous\">" +
            "<option value=\"\"" + (run.isAutonomous === null || run.isAutonomous === undefined ? " selected" : "") + ">auto</option>" +
            "<option value=\"true\"" + (run.isAutonomous === true ? " selected" : "") + ">true</option>" +
            "<option value=\"false\"" + (run.isAutonomous === false ? " selected" : "") + ">false</option>" +
          "</select></td>" +
          "<td class=\"num\">" + escapeHtml(normalizeTimestamp(run.timestamp)) + "</td>" +
          "<td class=\"num\">" +
            (overrideActive ? "<span class=\"chip\">edited</span> " : "") +
            "<button class=\"run-reset-btn\" data-source=\"" + escapeHtml(run.sourceEvent) + "\" data-runid=\"" + escapeHtml(run.runId) + "\">Reset</button>" +
          "</td>" +
          "</tr>";
      }).join("");

      ui.runsBoard.innerHTML =
        "<div class=\"scoreboard-title\">" +
          "<h2>All Runs</h2>" +
          "<div class=\"chips\"><span class=\"chip\">Visible runs: " + rows.length + "</span></div>" +
        "</div>" +
        "<div class=\"table-wrap\">" +
          "<table class=\"runs-table\">" +
            "<thead><tr>" +
              "<th>Car</th>" +
              "<th>Team</th>" +
              "<th>Event</th>" +
              "<th>Run ID</th>" +
              "<th>Run #</th>" +
              "<th>Raw Time [s]</th>" +
              "<th>Cones</th>" +
              "<th>Offtracks</th>" +
              "<th>Lap #</th>" +
              "<th>Completed Laps</th>" +
              "<th>Status</th>" +
              "<th>Result</th>" +
              "<th>Mode</th>" +
              "<th>Autonomous</th>" +
              "<th>Timestamp</th>" +
              "<th>Actions</th>" +
            "</tr></thead>" +
            "<tbody>" + bodyHtml + "</tbody>" +
          "</table>" +
        "</div>";
    }

    function render() {
      renderStatus();
      renderRunsBoard();
    }

    function normalizeFieldValue(field, rawValue) {
      if (field === "runNumber" || field === "lapNumber") {
        const n = toNumber(rawValue);
        return n === null ? null : Math.max(0, Math.floor(n));
      }
      if (field === "rawTime") {
        const n = toNumber(rawValue);
        return n === null ? null : Math.max(0, n);
      }
      if (field === "cones" || field === "offCourses" || field === "completedLaps") {
        return Math.max(0, Math.floor(toPenaltyNumber(rawValue)));
      }
      if (field === "status" || field === "result" || field === "modeText") {
        return String(rawValue || "").trim().toLowerCase();
      }
      if (field === "isAutonomous") {
        if (rawValue === "") return null;
        return String(rawValue).toLowerCase() === "true";
      }
      return rawValue;
    }

    function bindInputs() {
      document.body.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("run-input")) {
          const source = target.dataset.source;
          const runId = target.dataset.runid;
          const field = target.dataset.field;
          const value = normalizeFieldValue(field, target.value);
          liveStore.setRunOverride(source, runId, { [field]: value });
          logger.write("INFO", "Run manually edited", { source, runId, field, value });
          render();
          return;
        }

        if (target.id === "runFilterInput") {
          filterText = String(target.value || "").trim().toLowerCase();
          render();
        }
      });

      document.body.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        if (target.classList.contains("run-reset-btn")) {
          const source = target.dataset.source;
          const runId = target.dataset.runid;
          liveStore.clearRunOverride(source, runId);
          logger.write("INFO", "Run override reset", { source, runId });
          render();
        }
      });

      ui.reconnectBtn.addEventListener("click", () => {
        logger.write("INFO", "Manual reconnect requested");
        liveStore.connect();
      });

      ui.clearDebugBtn.addEventListener("click", () => {
        logger.clear();
        logger.write("INFO", "Debug log cleared");
      });

      ui.clearRunOverridesBtn.addEventListener("click", () => {
        if (!confirm("Clear all manual run edits?")) return;
        liveStore.clearAllRunOverrides();
        logger.write("INFO", "All run overrides cleared");
        render();
      });

      ui.runFilterInput.addEventListener("input", () => {
        filterText = String(ui.runFilterInput.value || "").trim().toLowerCase();
        render();
      });
    }

    return {
      async start() {
        bindInputs();
        render();
        await liveStore.connect();
      }
    };
  }

  const app = createApp();
  app.start().catch((error) => {
    console.error("Failed to start runs editor", error);
  });
})();