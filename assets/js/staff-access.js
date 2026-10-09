/* Shared browser-side route guard. Database RLS remains the authority. */
(function () {
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
      (admin.role === "STAFF" &&
        admin.is_active === true &&
        admin.must_change_password !== true &&
        Array.isArray(admin.page_permissions) &&
        admin.page_permissions.includes(page));
  }

  function landingPage(admin) {
    return pages.find(({ key }) => canVisit(admin, key))?.path || "admin.html";
  }

  async function getAccess(client, page) {
    const { data: { session }, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) {
      window.location.replace("admin.html");
      return null;
    }

    const { data: admin, error } = await client
      .from("admins")
      .select("id,email,role,page_permissions,must_change_password,is_active")
      .eq("id", session.user.id)
      .maybeSingle();
    if (error) throw error;
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

    for (const link of document.querySelectorAll(".sidebar-nav a[href]")) {
      const item = pages.find(({ path }) => path === link.getAttribute("href"));
      if (item) link.hidden = !canVisit(admin, item.key);
    }

    if (page && page !== "change-password" && !canVisit(admin, page)) {
      window.location.replace(landingPage(admin));
      return null;
    }
    return { user: session.user, admin };
  }

  window.staffLandingPage = landingPage;
  window.requireStaffPageAccess = getAccess;
  window.staffCanVisit = canVisit;
})();

