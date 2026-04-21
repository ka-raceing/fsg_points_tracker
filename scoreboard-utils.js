(function () {
  "use strict";

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function toPenaltyNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function normId(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function fmtTime(seconds) {
    return seconds === null ? "-" : seconds.toFixed(3) + "s";
  }

  function fmtPoints(points) {
    return points.toFixed(3);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class DebugLog {
    constructor(preEl) {
      this.preEl = preEl;
      this.lines = [];
      this.maxLines = 400;
    }

    write(level, text, payload) {
      const timestamp = new Date().toLocaleTimeString();
      let line = "[" + timestamp + "] " + level + " " + text;
      if (payload !== undefined) {
        try {
          line += " " + JSON.stringify(payload);
        } catch (error) {
          line += " [payload not serializable]";
        }
      }
      this.lines.push(line);
      if (this.lines.length > this.maxLines) {
        this.lines = this.lines.slice(this.lines.length - this.maxLines);
      }
      this.preEl.textContent = this.lines.join("\n");
      this.preEl.scrollTop = this.preEl.scrollHeight;
      console.log(line);
    }

    clear() {
      this.lines = [];
      this.preEl.textContent = "";
    }
  }

  window.FSG = window.FSG || {};
  window.FSG.utils = {
    toNumber,
    toPenaltyNumber,
    normId,
    fmtTime,
    fmtPoints,
    clamp,
    DebugLog
  };
})();
