(function () {
  "use strict";

  const pageCup = String(document.body.dataset.cup || "EV").toUpperCase() === "DV" ? "DV" : "EV";

  const CONFIG = {
    brokerUrl: "wss://mqtt.tk.formulastudent.de:443/mqtt",
    reconnectMs: 6000,
    topics: [
      "timekeeping/default/results/full",
      "timekeeping/+/results/full",
      "csd/+/full"
    ],
    competitions: {
      EV: {
        label: "EV Cup",
        dataFiles: {
          static: "ev_ede.csv",
          penalties: "ev_penelties.csv"
        },
        dynamicEvents: [
          {
            key: "skidpad",
            label: "Skidpad",
            source: "skidpad",
            maxPoints: 50,
            conePenaltySec: 0.2,
            offCoursePolicy: "dq",
            scoringModel: "manual_skidpad"
          },
          {
            key: "autonomous_skidpad",
            label: "Driverless Skidpad",
            source: "dv_skidpad",
            maxPoints: 75,
            conePenaltySec: 0.2,
            offCoursePolicy: "dq",
            scoringModel: "dc_skidpad"
          },
          {
            key: "acceleration",
            label: "Acceleration",
            source: "acceleration",
            maxPoints: 50,
            conePenaltySec: 2.0,
            offCoursePolicy: "dq",
            scoringModel: "manual_acceleration"
          },
          {
            key: "autonomous_acceleration",
            label: "Driverless Acceleration",
            source: "dv_acceleration",
            maxPoints: 75,
            conePenaltySec: 2.0,
            offCoursePolicy: "dq",
            scoringModel: "dc_acceleration"
          },
          {
            key: "autocross",
            label: "Autocross",
            source: "autocross",
            maxPoints: 100,
            conePenaltySec: 2.0,
            offCoursePolicy: "time",
            offCoursePenaltySec: 10,
            scoringModel: "manual_autocross"
          },
          {
            key: "endurance",
            label: "Endurance",
            source: "endurance",
            maxPoints: 250,
            conePenaltySec: 2.0,
            offCoursePolicy: "time",
            offCoursePenaltySec: 10,
            scoringModel: "manual_endurance"
          }
        ],
        staticEvents: [
          { key: "engineering_design", label: "Engineering Design", maxPoints: 150 },
          { key: "cost_manufacturing", label: "Cost & Manufacturing", maxPoints: 100 },
          { key: "business_plan", label: "Business Plan", maxPoints: 75 },
          { key: "efficiency", label: "Efficiency", maxPoints: 75 }
        ],
        penaltyEvents: [
          { key: "penalties", label: "Penalties", minPoints: -999, maxPoints: 0 }
        ]
      },
      DV: {
        label: "Driverless Cup",
        dataFiles: {
          static: "dv_ede.csv",
          penalties: "dv_penelties.csv"
        },
        dynamicEvents: [
          {
            key: "dv_skidpad",
            label: "Driverless Skidpad",
            source: "dv_skidpad",
            maxPoints: 75,
            conePenaltySec: 0.2,
            offCoursePolicy: "dq",
            scoringModel: "dc_skidpad"
          },
          {
            key: "dv_acceleration",
            label: "Driverless Acceleration",
            source: "dv_acceleration",
            maxPoints: 75,
            conePenaltySec: 2.0,
            offCoursePolicy: "dq",
            scoringModel: "dc_acceleration"
          },
          {
            key: "dv_autocross",
            label: "Driverless Autocross",
            source: "dv_autocross",
            maxPoints: 100,
            conePenaltySec: 2.0,
            offCoursePolicy: "time",
            offCoursePenaltySec: 10,
            scoringModel: "dc_autocross",
            trackLengthM: 336,
            referenceSpeedMps: 6
          },
          {
            key: "trackdrive",
            label: "Trackdrive",
            source: "trackdrive",
            maxPoints: 200,
            conePenaltySec: 2.0,
            offCoursePolicy: "points",
            offCoursePointsPenalty: 50,
            scoringModel: "dc_trackdrive",
            targetLaps: 10,
            pointsPerCompletedLap: 5
          }
        ],
        staticEvents: [
          { key: "engineering_design", label: "Engineering Design", maxPoints: 150 }
        ],
        penaltyEvents: [
          { key: "penalties", label: "Penalties", minPoints: -999, maxPoints: 0 }
        ]
      }
    }
  };

  const STORAGE_KEYS = {
    ev: "fsg_static_ev_points",
    dv: "fsg_static_dv_points"
  };

  const ui = {
    connectionBadge: document.getElementById("connectionBadge"),
    updateBadge: document.getElementById("updateBadge"),
    msgCountChip: document.getElementById("msgCountChip"),
    teamCountChip: document.getElementById("teamCountChip"),
    runCountChip: document.getElementById("runCountChip"),
    trackdriveLapsChip: document.getElementById("trackdriveLapsChip"),
    debugLog: document.getElementById("debugLog"),
    board: document.getElementById("board"),
    staticFile: document.getElementById("staticFile"),
    penaltiesFile: document.getElementById("penaltiesFile"),
    reconnectBtn: document.getElementById("reconnectBtn"),
    clearDebugBtn: document.getElementById("clearDebugBtn")
  };

  window.FSG = window.FSG || {};
  window.FSG.pageCup = pageCup;
  window.FSG.CONFIG = CONFIG;
  window.FSG.STORAGE_KEYS = STORAGE_KEYS;
  window.FSG.ui = ui;
})();
