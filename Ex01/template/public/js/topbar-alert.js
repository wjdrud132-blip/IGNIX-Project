(function () {
  const styleId = "fids-unified-topbar-alert-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = ".alert-dropdown{width:330px!important;max-height:420px!important;overflow:hidden!important}.alert-list{max-height:300px!important;overflow-y:auto!important}.alert-item{display:grid!important;grid-template-columns:42px 1fr 56px!important;gap:10px!important;padding:14px 16px!important;border-bottom:1px solid #f1f5f9!important}.alert-item.danger{background:#fff5f5!important}.alert-icon{width:34px!important;height:34px!important;border-radius:50%!important;display:grid!important;place-items:center!important}.alert-item.danger .alert-icon{background:#fee2e2!important;color:#ef4444!important}.alert-text{display:flex!important;flex-direction:column!important;gap:4px!important;min-width:0!important}.alert-text strong{font-size:14px!important;font-weight:800!important;color:#dc2626!important}.alert-text span{font-size:13px!important;font-weight:700!important;color:#111827!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}.alert-text small,.alert-time{font-size:12px!important;color:#94a3b8!important;line-height:1.35!important}.alert-more{width:100%!important;height:42px!important;border:0!important;background:#fff!important;color:#2563eb!important;font-weight:700!important;cursor:pointer!important}.alert-empty{padding:22px 16px!important;text-align:center!important;color:#94a3b8!important;font-size:13px!important}.all-alert-row.danger{background:#fff5f5!important}.all-alert-row.danger strong{color:#dc2626!important}";
    document.head.appendChild(style);
  }
  const ids = {
    button: document.getElementById("alertButton") || document.getElementById("topbarAlertButton"),
    dot: document.getElementById("alertDot") || document.getElementById("topbarAlertDot"),
    dropdown: document.getElementById("alertDropdown") || document.getElementById("topbarAlertDropdown"),
    list: document.getElementById("alertList") || document.getElementById("topbarAlertList"),
    readAll: document.getElementById("readAllBtn") || document.getElementById("topbarReadAllBtn"),
    openAll: document.getElementById("openAllAlertsBtn") || document.getElementById("topbarOpenAllAlertsBtn"),
    overlay: document.getElementById("allAlertOverlay") || document.getElementById("topbarAllAlertOverlay"),
    allList: document.getElementById("allAlertList") || document.getElementById("topbarAllAlertList"),
    closeAll: document.getElementById("closeAllAlertsBtn") || document.getElementById("topbarCloseAllAlertsBtn"),
  };
  if (!ids.button || !ids.dropdown || !ids.list) return;

  const READ_KEY = window.FIDS_ALERT_READ_KEY || "fids_alerts_read_all";
  let alerts = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function applyReadState(rows) {
    if (typeof window.fidsApplyAlertReadState === "function") return window.fidsApplyAlertReadState(rows);
    if (sessionStorage.getItem(READ_KEY) === "Y") return rows.map((row) => ({ ...row, is_received: "Y" }));
    return rows;
  }

  function markRead() {
    if (typeof window.fidsMarkAlertsRead === "function") window.fidsMarkAlertsRead();
    else sessionStorage.setItem(READ_KEY, "Y");
  }

  function displayBinId(item) {
    const id = item.display_bin_id || item.bin_id || "";
    return String(id).padStart(2, "0");
  }

  function timeOnly(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }

  function messageFor(item) {
    return item.alert_msg || "\uD654\uC7AC \uC704\uD5D8 \uAC10\uC9C0 - \uC989\uAC01 \uB300\uC751 \uD544\uC694";
  }

  function render() {
    if (ids.list) ids.list.dataset.fidsUnifiedRendering = "Y";
    const dangerAlerts = alerts.filter((item) => item.alert_type === "danger");
    const hasUnread = dangerAlerts.some((item) => item.is_received !== "Y");
    if (ids.dot) ids.dot.classList.toggle("hide", !hasUnread);

    if (!dangerAlerts.length) {
      const empty = '<div class="alert-empty">\uD45C\uC2DC\uD560 \uC704\uD5D8 \uC54C\uB9BC\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
      ids.list.innerHTML = empty;
      if (ids.allList) ids.allList.innerHTML = empty;
      return;
    }

    ids.list.innerHTML = dangerAlerts.slice(0, 5).map((item) => {
      const readClass = item.is_received === "Y" ? " read" : "";
      return '<div class="alert-item danger' + readClass + '">' +
        '<div class="alert-icon"><i class="ti ti-flame"></i></div>' +
        '<div class="alert-text"><strong>\uC704\uD5D8 \uAC10\uC9C0</strong>' +
          '<span>#' + escapeHtml(displayBinId(item)) + ' ' + escapeHtml(item.bin_loc || "") + '</span>' +
          '<small>' + escapeHtml(messageFor(item)) + '</small>' +
        '</div>' +
        '<span class="alert-time">' + timeOnly(item.alerted_at) + '</span>' +
      '</div>';
    }).join("");

    if (ids.allList) {
      ids.allList.dataset.fidsUnifiedRendering = "Y";
      ids.allList.innerHTML = dangerAlerts.map((item) => {
        const readClass = item.is_received === "Y" ? " read" : "";
        return '<div class="all-alert-row danger' + readClass + '">' +
          '<div><strong>\uC704\uD5D8 \uAC10\uC9C0</strong><span>#' + escapeHtml(displayBinId(item)) + ' ' + escapeHtml(item.bin_loc || "") + '</span></div>' +
          '<p>' + escapeHtml(messageFor(item)) + '</p>' +
          '<time>' + timeOnly(item.alerted_at) + '</time>' +
        '</div>';
      }).join("");
    }
  }

  async function load() {
    try {
      const response = await fetch("/alerts/list");
      const rows = await response.json();
      alerts = applyReadState(Array.isArray(rows) ? rows : []);
    } catch (error) {
      alerts = [];
    }
    render();
  }

  function toggleDropdown(event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    }
    ids.dropdown.classList.toggle("open");
  }

  ids.button.onclick = toggleDropdown;
  ids.button.addEventListener("click", toggleDropdown, true);

  if (ids.readAll) {
    ids.readAll.onclick = async () => {
      markRead();
      try { await fetch("/alerts/read-all", { method: "POST" }); } catch (error) {}
      await load();
    };
  }

  if (ids.openAll && ids.overlay) {
    ids.openAll.onclick = () => {
      ids.dropdown.classList.remove("open");
      ids.overlay.classList.add("open");
    };
  }

  if (ids.closeAll && ids.overlay) ids.closeAll.onclick = () => ids.overlay.classList.remove("open");
  if (ids.overlay) {
    ids.overlay.onclick = (event) => {
      if (event.target === ids.overlay) ids.overlay.classList.remove("open");
    };
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".alert-area")) ids.dropdown.classList.remove("open");
  });

  window.fidsReloadTopbarAlerts = load;
  if (window.MutationObserver && ids.list) {
    const observer = new MutationObserver(() => {
      if (ids.list.dataset.fidsUnifiedRendering === "Y") {
        delete ids.list.dataset.fidsUnifiedRendering;
        return;
      }
      render();
    });
    observer.observe(ids.list, { childList: true, subtree: false });
  }
  load();
  setTimeout(load, 300);
  setTimeout(render, 800);
})();
