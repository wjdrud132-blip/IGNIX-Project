const LIVE_DANGER_STATUS_KEY = "fidsLiveDangerStatusByBin";
const FIRE_ALERT_POLL_MS = 3000;

function loadDangerStatusByBin() {
  try {
    return JSON.parse(sessionStorage.getItem(LIVE_DANGER_STATUS_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveDangerStatusByBin(statusByBin) {
  sessionStorage.setItem(LIVE_DANGER_STATUS_KEY, JSON.stringify(statusByBin));
}

function isLiveDangerBin(bin) {
  return String(bin.sensor_online || "") === "Y" && String(bin.alert_type || "") === "danger";
}

function binStatusOf(bin) {
  if (isLiveDangerBin(bin)) return "danger";
  if (String(bin.sensor_online || "") === "N" || Number(bin.network_status) === 0) return "offline";
  if (String(bin.alert_type || "") === "warning") return "warning";
  return "normal";
}

function toDangerAlert(bin) {
  return {
    bin_id: bin.bin_id,
    location: bin.bin_loc || bin.location || "-",
    alerted_at: bin.sensor_created_at || bin.alerted_at || new Date().toISOString(),
    temp_value: bin.temp_value,
    smoke_value: bin.smoke_value,
    flame_value: bin.flame_value,
    alert_msg: bin.alert_msg || "",
  };
}

function sortDangerByLatest(a, b) {
  const aTime = new Date(a.sensor_created_at || a.alerted_at || 0).getTime();
  const bTime = new Date(b.sensor_created_at || b.alerted_at || 0).getTime();

  if (bTime !== aTime) return bTime - aTime;
  return Number(a.bin_id || 0) - Number(b.bin_id || 0);
}

async function checkDangerAlert() {
  try {
    if (document.querySelector(".fire-alert-overlay")) {
      return;
    }

    const response = await fetch("/trashbins/list", { cache: "no-store" });
    const rows = await response.json();
    const bins = Array.isArray(rows) ? rows : [];
    const previousStatusByBin = loadDangerStatusByBin();
    const nextStatusByBin = { ...previousStatusByBin };

    bins.forEach((bin) => {
      if (bin && bin.bin_id !== undefined && bin.bin_id !== null) {
        nextStatusByBin[String(bin.bin_id)] = binStatusOf(bin);
      }
    });

    const dangerRows = bins.filter(isLiveDangerBin).sort(sortDangerByLatest);
    const newDanger = dangerRows.find((bin) => previousStatusByBin[String(bin.bin_id)] !== "danger");

    saveDangerStatusByBin(nextStatusByBin);

    if (!newDanger) {
      return;
    }

    showDangerModal(toDangerAlert(newDanger));
  } catch (error) {
    console.error("실시간 위험 상태 확인 실패:", error);
  }
}

function parseAlertValue(alert, key) {
  if (key === "temp" && alert.temp_value !== undefined && alert.temp_value !== null && alert.temp_value !== "") {
    return alert.temp_value + "\u00B0C";
  }

  if (key === "smoke" && alert.smoke_value !== undefined && alert.smoke_value !== null && alert.smoke_value !== "") {
    return String(alert.smoke_value);
  }

  const msg = String(alert.alert_msg || "");

  if (key === "temp") {
    const match = msg.match(/온도\s*([0-9.]+)/);
    return match ? match[1] + "\u00B0C" : "-";
  }

  if (key === "smoke") {
    const match = msg.match(/연기\s*감지값\s*(\d+(?:\.\d+)?)/);
    return match ? match[1] : "-";
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
    overlay.remove();
    location.href = "/realtime?bin_id=" + encodeURIComponent(alert.bin_id);
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
setInterval(checkDangerAlert, FIRE_ALERT_POLL_MS);