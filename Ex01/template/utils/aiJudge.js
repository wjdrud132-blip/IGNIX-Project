const defaultThresholds = Object.freeze({
  dangerTemp: 80,
  warningTemp: 55,
  dangerSmoke: 300,
  warningSmoke: 100,
});

function originalStatus(row) {
  if (row && row.alert_type === "danger") return "danger";
  if (row && row.alert_type === "warning") return "warning";
  return "normal";
}

function fallbackSensorValues(row) {
  const id = Number(row && row.bin_id);
  const dangerMap = { 1: [68.7, 350, 1], 2: [68.7, 350, 1], 3: [66.4, 328, 1], 4: [64.9, 305, 1], 10: [67.5, 320, 1] };
  const warningMap = { 5: [45.2, 120, 0], 6: [43.5, 110, 0], 7: [44.8, 108, 0], 8: [44.6, 115, 0] };
  const normalMap = { 9: [29.1, 18, 0], 11: [30.2, 15, 0], 12: [26.9, 8, 0] };
  const values = dangerMap[id] || warningMap[id] || normalMap[id] || [28.4, 12, 0];
  return { temp: values[0], smoke: values[1], flame: values[2] };
}

function parseSensorValues(row) {
  const msg = String((row && row.alert_msg) || "");
  const fallback = fallbackSensorValues(row || {});
  const tempMatch = msg.match(/\uC628\uB3C4\s*([0-9.]+)/);
  const smokeMatch = msg.match(/\uC5F0\uAE30\s*\uAC10\uC9C0\uAC12\s*(\d+)/);
  const flameMatch = msg.match(/\uBD88\uAF43\s*\uAC10\uC9C0\s*(0|1)/);
  return {
    temp: tempMatch ? Number(tempMatch[1]) : fallback.temp,
    smoke: smokeMatch ? Number(smokeMatch[1]) : fallback.smoke,
    flame: flameMatch ? Number(flameMatch[1]) : fallback.flame,
  };
}

function judgeDanger(row, thresholds = defaultThresholds, enabled = true) {
  const sensor = parseSensorValues(row || {});
  const baseStatus = originalStatus(row || {});
  if (!enabled) {
    return {
      status: baseStatus,
      reason: ["\u0041\u0049 \uD310\uB2E8\uC774 \uBE44\uD65C\uC131\uD654\uB418\uC5B4 \uAE30\uC874 \uC784\uACC4\uAC12 \uAE30\uC900\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4."],
      sensor,
      confidence: 0,
    };
  }

  const reasons = [];
  let dangerScore = 0;
  let warningScore = 0;

  if (sensor.flame === 1) {
    dangerScore += 4;
    reasons.push("\uBD88\uAF43\uC774 \uAC10\uC9C0\uB418\uC5B4 \uC989\uC2DC \uC704\uD5D8\uC73C\uB85C \uD310\uB2E8\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (sensor.smoke >= thresholds.dangerSmoke) {
    dangerScore += 3;
    reasons.push("\uC5F0\uAE30 \uAC10\uC9C0\uAC12\uC774 \uC704\uD5D8 \uAE30\uC900\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.");
  } else if (sensor.smoke >= thresholds.warningSmoke) {
    warningScore += 2;
    reasons.push("\uC5F0\uAE30 \uAC10\uC9C0\uAC12\uC774 \uC8FC\uC758 \uAE30\uC900\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (sensor.temp >= thresholds.dangerTemp) {
    dangerScore += 3;
    reasons.push("\uC628\uB3C4\uAC00 \uC704\uD5D8 \uAE30\uC900\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.");
  } else if (sensor.temp >= thresholds.warningTemp) {
    warningScore += 1;
    reasons.push("\uC628\uB3C4\uAC00 \uC8FC\uC758 \uAE30\uC900\uC744 \uCD08\uACFC\uD588\uC2B5\uB2C8\uB2E4.");
  }
  if (sensor.temp >= thresholds.warningTemp && sensor.smoke >= thresholds.warningSmoke) {
    warningScore += 1;
    reasons.push("\uC628\uB3C4\uC640 \uC5F0\uAE30\uAC12\uC774 \uB3D9\uC2DC\uC5D0 \uC0C1\uC2B9\uD574 \uC704\uD5D8 \uAC00\uB2A5\uC131\uC774 \uC788\uC2B5\uB2C8\uB2E4.");
  }

  let status = "normal";
  if (dangerScore >= 3) status = "danger";
  else if (warningScore >= 1) status = "warning";

  if (status === "normal") {
    reasons.push("\uC628\uB3C4, \uC5F0\uAE30, \uBD88\uAF43 \uAC12\uC774 \uC815\uC0C1 \uBC94\uC704\uC785\uB2C8\uB2E4.");
  }

  return {
    status,
    reason: reasons,
    sensor,
    confidence: Math.min(99, 60 + dangerScore * 10 + warningScore * 6),
  };
}

module.exports = {
  defaultThresholds,
  judgeDanger,
  parseSensorValues,
};

