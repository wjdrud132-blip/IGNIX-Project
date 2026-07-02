let lastAlertId = sessionStorage.getItem("lastShownAlertId");

async function rememberCurrentDangerAlert() {
  try {
    const response = await fetch("/alerts/danger/latest");
    const data = await response.json();

    if (data.hasDanger && data.alert_id && !lastAlertId) {
      lastAlertId = data.alert_id;
      sessionStorage.setItem("lastShownAlertId", data.alert_id);
    }
  } catch (error) {
    console.error("현재 위험 알림 기준값 저장 실패:", error);
  }
}

async function checkDangerAlert() {
  try {
    const response = await fetch("/alerts/danger/latest");
    const data = await response.json();

    if (!data.hasDanger || !data.alert_id) {
      return;
    }

    if (String(data.alert_id) === String(lastAlertId)) {
      return;
    }

    lastAlertId = data.alert_id;
    sessionStorage.setItem("lastShownAlertId", data.alert_id);
    showDangerModal(data);
  } catch (error) {
    console.error("위험 알림 확인 실패:", error);
  }
}

function parseAlertValue(alert, key) {
  if (key === "temp" && alert.temp_value !== undefined && alert.temp_value !== null && alert.temp_value !== "") return alert.temp_value + "\u00B0C";
  if (key === "smoke" && alert.smoke_value !== undefined && alert.smoke_value !== null && alert.smoke_value !== "") return alert.smoke_value + " (\uC704\uD5D8)";
  const msg = String(alert.alert_msg || "");
  if (key === "temp") {
    const match = msg.match(/\uC628\uB3C4\s*([0-9.]+)/);
    return match ? match[1] + "\u00B0C" : "-";
  }
  if (key === "smoke") {
    const match = msg.match(/\uC5F0\uAE30\s*\uAC10\uC9C0\uAC12\s*(\d+(?:\.\d+)?)/);
    return match ? match[1] + " (\uC704\uD5D8)" : "-";
  }
  return "-";
}

function showDangerModal(alert) {
  if (document.querySelector(".fire-alert-overlay")) {
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "fire-alert-overlay";

  overlay.innerHTML = `
    <div class="fire-alert-modal">
      <div class="fire-alert-top">
        <div class="fire-icon"><i class="ti ti-flame"></i></div>
        <div>
          <div class="fire-badge"><span></span> 위험 감지</div>
          <h2>화재 위험이 감지되었습니다</h2>
        </div>
      </div>

      <div class="fire-alert-body">
        <div class="fire-info-grid">
          <div class="fire-info-box">
            <span>위치</span>
            <strong>${alert.location || "-"}</strong>
          </div>
          <div class="fire-info-box">
            <span>감지 시각</span>
            <strong>${formatTime(alert.alerted_at)}</strong>
          </div>
          <div class="fire-info-box">
            <span>내부 온도</span>
            <strong class="danger-text">${parseAlertValue(alert, "temp")}</strong>
          </div>
          <div class="fire-info-box">
            <span>연기 감지값</span>
            <strong class="danger-text">${parseAlertValue(alert, "smoke")}</strong>
          </div>
        </div>

        <div class="fire-alert-date">
          ${formatDate(alert.alerted_at)} 기준
        </div>

        <div class="fire-alert-actions">
          <button type="button" class="fire-move-btn">→ 해당 위치로 이동</button>
          <button type="button" class="fire-close-btn">닫기</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector(".fire-close-btn").addEventListener("click", () => {
    overlay.remove();
  });

  overlay.querySelector(".fire-move-btn").addEventListener("click", () => {
    if (alert.alert_id) {
      lastAlertId = alert.alert_id;
      sessionStorage.setItem("lastShownAlertId", alert.alert_id);
    }

    overlay.remove();

    location.href = "/realtime?bin_id=" + alert.bin_id;
  });
}

function formatTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function formatDate(value) {
  if (!value) return "현재";

  const date = new Date(value);
  return date.toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

checkDangerAlert();
setInterval(checkDangerAlert, 10000);



