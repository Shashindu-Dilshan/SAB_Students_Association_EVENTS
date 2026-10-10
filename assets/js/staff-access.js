/* Shared browser-side route guard. Database RLS remains the authority. */
(function () {
  document.documentElement.classList.add("staff-access-pending");
  const pages = [
    { key: "dashboard", label: "Dashboard", path: "admin-dashboard.html" },
    { key: "participants", label: "Participants", path: "participants.html" },
    { key: "tickets", label: "Tickets", path: "tickets.html" },
    { key: "event", label: "Event", path: "event.html" },
    { key: "scanner", label: "Scanner", path: "scanner.html" },
    { key: "settings", label: "Settings", path: "settings.html" },
  ];

  function canVisit(admin, page) {
    return admin.role === "ADMIN" ||
      (admin.role === "STAFF" && admin.is_active === true &&
        admin.must_change_password !== true &&
        Array.isArray(admin.page_permissions) &&
        admin.page_permissions.includes(page));
  }

  function landingPage(admin) {
    return pages.find(({ key }) => canVisit(admin, key))?.path || "admin.html";
  }

  async function getAdminContactEmail(client) {
    const { data, error } = await client.rpc("get_admin_contact_email");
    if (error) throw error;
    return typeof data === "string" && data.trim() ? data.trim() : "";
  }

  function showNotice({ email = "", error = "", canGoDashboard = false, retry = null } = {}) {
    let panel = document.getElementById("staffAccessNotice");
    if (!panel) {
      if (!document.getElementById("staffAccessNoticeStyles")) {
        document.head.insertAdjacentHTML("beforeend", `<style id="staffAccessNoticeStyles">
          .staff-access-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.62)}
          .staff-access-backdrop[hidden]{display:none}.staff-access-panel{position:relative;width:min(100%,480px);padding:32px;border-radius:16px;background:#fff;color:#1f2937;box-shadow:0 24px 70px rgba(0,0,0,.3);font:15px/1.6 Arial,Helvetica,sans-serif}
          .staff-access-panel h1{margin:8px 0 18px;color:#111827;font-size:25px}.staff-access-panel p{margin:0 0 12px}.staff-access-icon{font-size:30px}.staff-access-close{position:absolute;right:14px;top:12px;border:0;background:none;color:#6b7280;font-size:27px;cursor:pointer}
          .staff-access-email{overflow-wrap:anywhere}.staff-access-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.staff-access-button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:9px 14px;border:0;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font:600 14px Arial,Helvetica,sans-serif;cursor:pointer}
          .staff-access-contact{background:#1d4ed8}.staff-access-dashboard{background:#374151}.staff-access-retry{background:#b45309}.staff-access-button[aria-disabled=true]{opacity:.55;pointer-events:none}.staff-access-error{color:#b45309;font-size:13px}
          @media(max-width:520px){.staff-access-panel{padding:26px 22px}.staff-access-actions{flex-direction:column}.staff-access-button{width:100%}}
        </style>`);
      }
      document.body.insertAdjacentHTML("beforeend", `
        <div id="staffAccessNotice" class="staff-access-backdrop" role="presentation">
          <section class="staff-access-panel" role="alertdialog" aria-modal="true" aria-labelledby="staffAccessTitle">
            <button class="staff-access-close" type="button" data-access-action="close" aria-label="Close">×</button>
            <div class="staff-access-icon" aria-hidden="true">🔒</div>
            <h1 id="staffAccessTitle">Access Denied</h1>
            <p>You do not have permission to access this tab with your current role.</p>
            <p>Please contact the administrator for access or assistance.</p>
            <p class="staff-access-email"><strong>Administrator email:</strong> <span data-admin-email></span></p>
            <p class="staff-access-error" data-access-error role="status"></p>
            <div class="staff-access-actions">
              <a class="staff-access-button staff-access-contact" data-contact-admin>Contact Administrator</a>
              <button class="staff-access-button staff-access-dashboard" data-access-action="dashboard" type="button">Go to Dashboard</button>
              <button class="staff-access-button staff-access-retry" data-access-action="retry" type="button">Retry</button>
            </div>
          </section>
        </div>`);
      panel = document.getElementById("staffAccessNotice");
      panel.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-access-action]")?.dataset.accessAction;
        if (action === "close") panel.hidden = true;
        if (action === "dashboard") {
          const access = await getAccess(window.staffAccessClient, "dashboard", { showDenied: false });
          if (access) window.location.assign("admin-dashboard.html");
        }
        if (action === "retry" && typeof panel.staffAccessRetry === "function") await panel.staffAccessRetry();
      });
    }

    panel.hidden = false;
    panel.querySelector("[data-admin-email]").textContent = email || "Not configured";
    const contact = panel.querySelector("[data-contact-admin]");
    if (email) {
      const subject = "Request for Access – SABSA E-Ticket System";
      const body = "Hello,\n\nI need permission to access a restricted page in the SABSA E-Ticket System. Could you please review my account's page access?\n\nThank you.";
      contact.href = `mailto:${encodeURI(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      contact.removeAttribute("aria-disabled");
      contact.removeAttribute("title");
    } else {
      contact.removeAttribute("href");
      contact.setAttribute("aria-disabled", "true");
      contact.title = "Administrator email is not configured.";
    }
    panel.querySelector("[data-access-error]").textContent = error;
    panel.querySelector("[data-admin-email]").textContent = email || (error ? "Unable to load" : "Not configured");
    panel.querySelector("[data-access-action='dashboard']").hidden = !canGoDashboard;
    panel.querySelector("[data-access-action='retry']").hidden = !retry;
    panel.staffAccessRetry = retry;
  }

  function installNavigationGuard(client) {
    if (document.documentElement.dataset.staffNavigationGuard === "true") return;
    document.documentElement.dataset.staffNavigationGuard = "true";
    document.addEventListener("click", async (event) => {
      const link = event.target.closest(".sidebar-nav a[href]");
      if (!link) return;
      const page = pages.find(({ path }) => path === link.getAttribute("href"));
      if (!page) return;
      event.preventDefault();
      const access = await getAccess(client, page.key);
      if (access) window.location.assign(page.path);
    });
  }

  async function getAccess(client, page, options = {}) {
    window.staffAccessClient = client;
    installNavigationGuard(client);
    let session;
    try {
      const response = await client.auth.getSession();
      if (response.error) throw response.error;
      session = response.data?.session;
    } catch (error) {
      showNotice({ error: "Unable to verify your session. Please retry.", retry: () => getAccess(client, page, options) });
      return null;
    }
    if (!session) {
      window.location.replace("admin.html");
      return null;
    }

    let admin;
    try {
      const response = await client.from("admins")
        .select("id,email,role,page_permissions,must_change_password,is_active")
        .eq("id", session.user.id).maybeSingle();
      if (response.error?.status === 401) {
        await client.auth.signOut();
        window.location.replace("admin.html");
        return null;
      }
      if (response.error) throw response.error;
      admin = response.data;
    } catch (error) {
      showNotice({ error: "We could not load your permissions. Please retry.", retry: () => getAccess(client, page, options) });
      return null;
    }
    if (!admin || !admin.is_active || !["ADMIN", "STAFF"].includes(admin.role)) {
      await client.auth.signOut();
      window.location.replace("admin.html");
      return null;
    }

    if (admin.role === "STAFF" && admin.must_change_password && page !== "change-password") {
      window.location.replace("force-password-change.html");
      return null;
    }
    if (page === "change-password" && !admin.must_change_password) {
      window.location.replace(landingPage(admin));
      return null;
    }

    document.documentElement.classList.remove("staff-access-pending");
    if (page && page !== "change-password" && !canVisit(admin, page)) {
      if (options.showDenied === false) return null;
      let email = "";
      let emailError = "";
      try { email = await getAdminContactEmail(client); }
      catch (error) { emailError = "Administrator contact details could not be loaded. Retry to try again."; }
      showNotice({
        email,
        error: emailError,
        canGoDashboard: canVisit(admin, "dashboard"),
        retry: () => getAccess(client, page, options),
      });
      return null;
    }
    const notice = document.getElementById("staffAccessNotice");
    if (notice) notice.hidden = true;
    return { user: session.user, admin };
  }

  window.staffLandingPage = landingPage;
  window.requireStaffPageAccess = getAccess;
  window.staffCanVisit = canVisit;
})();
