const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalActions = document.getElementById("modalActions");

function escapeHtml(value = "") {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function closeModal() {
    if (modal?.open) {
        modal.close();
    }
}

function openModal(title, bodyHtml, actionsHtml = "") {
    modalTitle.textContent = title;
    modalBody.innerHTML = bodyHtml;
    modalActions.innerHTML = actionsHtml;
    modal.showModal();
}

async function jsonRequest(url, method = "GET", payload = null, isForm = false) {
    const options = { method, headers: {} };
    if (payload) {
        if (isForm) {
            options.body = payload;
        } else {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(payload);
        }
    }
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
    }
    return data;
}

function createCourseModal() {
    openModal(
        "Create Course",
        `
            <label class="field">
                <span>Course name</span>
                <input class="input" id="courseNameInput">
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button" id="submitCreateCourse">Create</button>
        `
    );

    let isSubmitting = false;
    const submitButton = document.getElementById("submitCreateCourse");
    const nameInput = document.getElementById("courseNameInput");

    const submit = async () => {
        if (isSubmitting) return;
        const name = nameInput?.value?.trim();
        if (!name) return alert("Course name is required.");
        isSubmitting = true;
        if (submitButton) submitButton.disabled = true;
        try {
            const data = await jsonRequest("/api/courses", "POST", { name });
            window.location.href = data.redirect;
        } finally {
            isSubmitting = false;
            if (submitButton) submitButton.disabled = false;
        }
    };

    submitButton?.addEventListener("click", submit);
    nameInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") submit();
    });
}

function renameCourseModal(button) {
    const wrapper = button.closest("[data-course-card]");
    const courseId = wrapper.dataset.courseId;
    const currentName = wrapper.dataset.courseName;
    openModal(
        "Rename Course",
        `
            <label class="field">
                <span>Course name</span>
                <input class="input" id="renameCourseInput" value="${escapeHtml(currentName)}">
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button" id="submitRenameCourse">Save</button>
        `
    );
    document.getElementById("submitRenameCourse")?.addEventListener("click", async () => {
        const name = document.getElementById("renameCourseInput")?.value.trim();
        if (!name) return alert("Course name cannot be empty.");
        await jsonRequest(`/api/courses/${courseId}`, "PATCH", { name });
        window.location.reload();
    });
}

async function togglePinCourse(button) {
    const wrapper = button.closest("[data-course-card]");
    const courseId = wrapper.dataset.courseId;
    const pinned = wrapper.dataset.coursePinned === "1";
    await jsonRequest(`/api/courses/${courseId}`, "PATCH", { pinned: !pinned });
    window.location.reload();
}

function deleteCourseModal(button) {
    const wrapper = button.closest("[data-course-card]");
    const courseId = wrapper.dataset.courseId;
    const currentName = wrapper.dataset.courseName;
    openModal(
        "Delete Course",
        `<p>Delete <strong>${escapeHtml(currentName)}</strong>? This also removes its folders, files, and saved links.</p>`,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button danger" id="submitDeleteCourse">Delete</button>
        `
    );
    document.getElementById("submitDeleteCourse")?.addEventListener("click", async () => {
        const data = await jsonRequest(`/api/courses/${courseId}`, "DELETE");
        window.location.href = data.redirect;
    });
}

async function shareCourse(button) {
    const wrapper = button.closest("[data-course-card]");
    const courseId = wrapper.dataset.courseId;
    const data = await jsonRequest(`/api/courses/${courseId}/share`, "POST");
    openModal(
        "Share Course",
        `
            <label class="field">
                <span>Share link</span>
                <input class="input" id="shareCourseLink" value="${escapeHtml(data.share_url)}" readonly>
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Close</button>
            <button type="button" class="primary-button" id="copyShareLink">Copy Link</button>
        `
    );
    document.getElementById("copyShareLink")?.addEventListener("click", async () => {
        const input = document.getElementById("shareCourseLink");
        await navigator.clipboard.writeText(input.value);
        input.select();
    });
}

function createItemModal() {
    const page = document.querySelector("[data-course-page]");
    const courseId = page.dataset.courseId;
    const activeNodeId = page.dataset.activeNodeId;
    const activeNodeType = page.dataset.activeNodeType;
    const activeParentId = page.dataset.activeParentId;
    const parentId = activeNodeType === "folder" ? activeNodeId : activeParentId;
    openModal(
        "Add to Course",
        `
            <label class="field">
                <span>Item type</span>
                <select class="select" id="itemType">
                    <option value="folder">Folder</option>
                    <option value="file">File upload</option>
                    <option value="link">Hyperlink</option>
                </select>
            </label>
            <label class="field">
                <span>Name</span>
                <input class="input" id="itemName" placeholder="Example: Intro">
            </label>
            <label class="field" id="fileField" style="display:none;">
                <span>Upload file</span>
                <input class="input" id="itemFile" type="file">
            </label>
            <label class="field" id="linkField" style="display:none;">
                <span>Hyperlink URL</span>
                <input class="input" id="itemUrl" placeholder="https://example.com">
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button" id="submitCreateItem">Save</button>
        `
    );

    const itemType = document.getElementById("itemType");
    const toggleFields = () => {
        document.getElementById("fileField").style.display = itemType.value === "file" ? "grid" : "none";
        document.getElementById("linkField").style.display = itemType.value === "link" ? "grid" : "none";
    };
    itemType.addEventListener("change", toggleFields);
    toggleFields();

    document.getElementById("submitCreateItem")?.addEventListener("click", async () => {
        const formData = new FormData();
        formData.append("type", itemType.value);
        formData.append("name", document.getElementById("itemName").value.trim());
        formData.append("parent_id", parentId || "");
        if (itemType.value === "file") {
            const file = document.getElementById("itemFile").files[0];
            if (!file) return alert("Please choose a file.");
            formData.append("file", file);
        }
        if (itemType.value === "link") {
            formData.append("external_url", document.getElementById("itemUrl").value.trim());
        }
        await jsonRequest(`/api/courses/${courseId}/nodes`, "POST", formData, true);
        window.location.reload();
    });
}

function renameNodeModal(button) {
    const wrapper = button.closest("[data-node-card]");
    const nodeId = wrapper.dataset.nodeId;
    const currentName = wrapper.dataset.nodeName;
    openModal(
        "Rename Item",
        `
            <label class="field">
                <span>Name</span>
                <input class="input" id="renameNodeInput" value="${escapeHtml(currentName)}">
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button" id="submitRenameNode">Save</button>
        `
    );
    document.getElementById("submitRenameNode")?.addEventListener("click", async () => {
        const name = document.getElementById("renameNodeInput").value.trim();
        if (!name) return alert("Name cannot be empty.");
        await jsonRequest(`/api/nodes/${nodeId}`, "PATCH", { name });
        window.location.reload();
    });
}

async function togglePinNode(button) {
    const wrapper = button.closest("[data-node-card]");
    const nodeId = wrapper.dataset.nodeId;
    const pinned = wrapper.dataset.nodePinned === "1";
    await jsonRequest(`/api/nodes/${nodeId}`, "PATCH", { pinned: !pinned });
    window.location.reload();
}

function deleteNodeModal(button) {
    const wrapper = button.closest("[data-node-card]");
    const nodeId = wrapper.dataset.nodeId;
    const currentName = wrapper.dataset.nodeName;
    openModal(
        "Delete Item",
        `<p>Delete <strong>${escapeHtml(currentName)}</strong>? Nested sub-folders and files inside it will also be removed.</p>`,
        `
            <button type="button" class="secondary-button" data-close-modal>Cancel</button>
            <button type="button" class="primary-button danger" id="submitDeleteNode">Delete</button>
        `
    );
    document.getElementById("submitDeleteNode")?.addEventListener("click", async () => {
        await jsonRequest(`/api/nodes/${nodeId}`, "DELETE");
        window.location.reload();
    });
}

async function shareNode(button) {
    const wrapper = button.closest("[data-node-card]");
    const page = document.querySelector("[data-course-page]");
    if (!wrapper || !page) return;
    const courseId = page.dataset.courseId;
    const nodeId = wrapper.dataset.nodeId;
    const nodeName = wrapper.dataset.nodeName;
    const data = await jsonRequest(`/api/courses/${courseId}/share`, "POST");
    const shareUrl = new URL(data.share_url, window.location.origin);
    shareUrl.searchParams.set("node", nodeId);
    openModal(
        "Share Item",
        `
            <label class="field">
                <span>Share link for ${escapeHtml(nodeName)}</span>
                <input class="input" id="shareNodeLink" value="${escapeHtml(shareUrl.toString())}" readonly>
            </label>
        `,
        `
            <button type="button" class="secondary-button" data-close-modal>Close</button>
            <button type="button" class="primary-button" id="copyNodeShareLink">Copy Link</button>
        `
    );
    document.getElementById("copyNodeShareLink")?.addEventListener("click", async () => {
        const input = document.getElementById("shareNodeLink");
        await navigator.clipboard.writeText(input.value);
        input.select();
    });
}

function closeMenus(except = null) {
    document.querySelectorAll(".card-menu-wrap").forEach((wrap) => {
        const menu = wrap.querySelector(".card-menu");
        const button = wrap.querySelector(".dots-button");
        if (!menu || !button || wrap === except) return;
        menu.hidden = true;
        button.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll("[data-node-card]").forEach((wrap) => {
        const menu = wrap.querySelector(".node-context-menu");
        if (!menu || wrap === except) return;
        menu.hidden = true;
    });
}

function openNodeContextMenu(wrapper, x, y) {
    const menu = wrapper?.querySelector(".node-context-menu");
    if (!menu) return;
    closeMenus(wrapper);
    menu.hidden = false;
    const { innerWidth, innerHeight } = window;
    const menuWidth = menu.offsetWidth || 150;
    const menuHeight = menu.offsetHeight || 160;
    const left = Math.min(x, innerWidth - menuWidth - 12);
    const top = Math.min(y, innerHeight - menuHeight - 12);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${Math.max(12, top)}px`;
}

document.addEventListener("click", async (event) => {
    const actionTarget = event.target.closest("[data-action], [data-modal], [data-close-modal]");
    if (!actionTarget) {
        closeMenus();
        return;
    }

    if (actionTarget.hasAttribute("data-close-modal")) {
        closeModal();
        return;
    }

    const action = actionTarget.dataset.action;
    const modalAction = actionTarget.dataset.modal;

    try {
        if (action === "toggle-tree-folder") {
            event.preventDefault();
            event.stopPropagation();
            const details = actionTarget.closest("details.tree-folder");
            if (details) details.open = !details.open;
            return;
        }
        if (action === "toggle-preview-fullscreen") {
            event.preventDefault();
            const box = actionTarget.closest(".preview-box");
            if (!box) return;
            if (document.fullscreenElement === box) {
                await document.exitFullscreen();
            } else {
                await box.requestFullscreen();
            }
            return;
        }
        if (modalAction === "create-course") createCourseModal();
        if (action === "toggle-course-menu") {
            event.preventDefault();
            event.stopPropagation();
            const wrap = actionTarget.closest(".card-menu-wrap");
            const menu = wrap?.querySelector(".card-menu");
            if (wrap && menu) {
                const willOpen = menu.hidden;
                closeMenus(wrap);
                menu.hidden = !willOpen;
                actionTarget.setAttribute("aria-expanded", String(willOpen));
            }
            return;
        }
        if (action === "rename-course") {
            event.preventDefault();
            renameCourseModal(actionTarget);
            closeMenus();
        }
        if (action === "toggle-pin-course") {
            event.preventDefault();
            closeMenus();
            await togglePinCourse(actionTarget);
        }
        if (action === "share-course") {
            event.preventDefault();
            closeMenus();
            await shareCourse(actionTarget);
        }
        if (action === "delete-course") {
            event.preventDefault();
            deleteCourseModal(actionTarget);
            closeMenus();
        }
        if (action === "open-create-item") createItemModal();
        if (action === "rename-node") {
            closeMenus();
            renameNodeModal(actionTarget);
        }
        if (action === "toggle-pin-node") {
            closeMenus();
            await togglePinNode(actionTarget);
        }
        if (action === "share-node") {
            closeMenus();
            await shareNode(actionTarget);
        }
        if (action === "delete-node") {
            closeMenus();
            deleteNodeModal(actionTarget);
        }
    } catch (error) {
        alert(error.message);
    }
});

function syncPreviewFullscreenButtons() {
    const fullscreenElement = document.fullscreenElement;
    document.querySelectorAll(".preview-fullscreen-btn").forEach((button) => {
        const box = button.closest(".preview-box");
        const isFullscreen = box && fullscreenElement === box;
        button.querySelector('[data-icon="enter"]')?.toggleAttribute("hidden", isFullscreen);
        button.querySelector('[data-icon="exit"]')?.toggleAttribute("hidden", !isFullscreen);
        button.title = isFullscreen ? "Exit full screen" : "Full screen";
    });
}

document.addEventListener("fullscreenchange", syncPreviewFullscreenButtons);
syncPreviewFullscreenButtons();

document.addEventListener("contextmenu", (event) => {
    const nodeWrap = event.target.closest("[data-node-card]");
    if (!nodeWrap) {
        closeMenus();
        return;
    }
    event.preventDefault();
    openNodeContextMenu(nodeWrap, event.clientX, event.clientY);
});

modal?.addEventListener("click", (event) => {
    const card = document.getElementById("modalCard");
    const box = card.getBoundingClientRect();
    const clickedInside =
        box.top <= event.clientY &&
        event.clientY <= box.top + box.height &&
        box.left <= event.clientX &&
        event.clientX <= box.left + box.width;
    if (!clickedInside) {
        closeModal();
    }
});

document.getElementById("themeSelect")?.addEventListener("change", async (event) => {
    const theme = event.target.value;
    document.documentElement.dataset.theme = theme;
    try {
        await jsonRequest("/api/theme", "POST", { theme });
    } catch (error) {
        alert(error.message);
    }
});

function getDirectTreeChildren(itemEl) {
    const details = itemEl.querySelector(":scope > details.tree-folder");
    const childrenWrap = details?.querySelector(":scope > .tree-children");
    if (!childrenWrap) return [];
    return Array.from(childrenWrap.children).filter((child) => child.classList?.contains("tree-item"));
}

function normalizeQuery(value) {
    return (value || "").trim().toLowerCase();
}

function filterTreeItem(itemEl, query) {
    const labelText = itemEl.querySelector(".tree-label")?.textContent?.toLowerCase() || "";
    const selfMatch = !query || labelText.includes(query);
    const children = getDirectTreeChildren(itemEl);
    let childMatch = false;
    for (const child of children) {
        if (filterTreeItem(child, query)) childMatch = true;
    }
    const match = selfMatch || childMatch;
    itemEl.style.display = match ? "" : "none";

    const details = itemEl.querySelector(":scope > details.tree-folder");
    if (details) {
        if (!details.dataset.initialOpen) {
            details.dataset.initialOpen = details.hasAttribute("open") ? "1" : "0";
        }
        if (!query) {
            details.open = details.dataset.initialOpen === "1";
        } else {
            details.open = childMatch || selfMatch;
        }
    }

    return match;
}

function applyTreeFilter(rawQuery) {
    const query = normalizeQuery(rawQuery);
    document.querySelectorAll(".tree-list > .tree-item").forEach((item) => {
        filterTreeItem(item, query);
    });
}

document.getElementById("treeSearch")?.addEventListener("input", (event) => {
    applyTreeFilter(event.target.value);
});

applyTreeFilter(document.getElementById("treeSearch")?.value || "");

function sendReadingTime(payload) {
    const url = "/api/track-reading";
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon(url, blob);
        return;
    }
    fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
    }).catch(() => {});
}

function setupReadingTimer() {
    const page = document.querySelector("[data-course-page]");
    if (!page) return;
    const courseId = Number(page.dataset.courseId);
    const nodeId = Number(page.dataset.activeNodeId);
    if (!courseId || !nodeId) return;

    let startedAt = Date.now();
    let sentSeconds = 0;

    const flush = () => {
        const deltaSeconds = Math.floor((Date.now() - startedAt) / 1000);
        const toSend = deltaSeconds - sentSeconds;
        if (toSend >= 2) {
            sentSeconds += toSend;
            sendReadingTime({ course_id: courseId, node_id: nodeId, seconds: toSend });
        }
    };

    const onVisibility = () => {
        if (document.hidden) {
            flush();
        } else {
            startedAt = Date.now();
            sentSeconds = 0;
        }
    };

    const onUnload = () => {
        flush();
    };

    const interval = window.setInterval(flush, 15000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onUnload);
    window.addEventListener("beforeunload", onUnload);

    // immediate mark (helps chart appear after first open)
    window.setTimeout(flush, 2500);

    return () => {
        window.clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onUnload);
        window.removeEventListener("beforeunload", onUnload);
    };
}

setupReadingTimer();

function formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function drawDonutChart(canvas, items) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = Math.min(canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const outerR = size * 0.46;
    const innerR = size * 0.28;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const total = items.reduce((sum, item) => sum + item.seconds, 0);

    const ringBg = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fillStyle = ringBg;
    ctx.fill("evenodd");

    if (!total) return;

    let start = -Math.PI / 2;
    for (const item of items) {
        const angle = (item.seconds / total) * Math.PI * 2;
        const end = start + angle;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, start, end);
        ctx.arc(cx, cy, innerR, end, start, true);
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();
        start = end;
    }

    return { cx, cy, outerR, innerR, total };
}

function buildLegend(container, items) {
    container.innerHTML = "";
    const total = items.reduce((sum, item) => sum + item.seconds, 0);
    for (const item of items) {
        const row = document.createElement("div");
        row.className = "legend-row";
        const left = document.createElement("div");
        left.className = "legend-label";
        const dot = document.createElement("span");
        dot.className = "legend-dot";
        dot.style.background = item.color;
        const label = document.createElement("span");
        label.textContent = item.label;
        left.append(dot, label);
        row.append(left);
        container.append(row);
    }
}

function pickDonutItem(items, total, angleRad) {
    let start = -Math.PI / 2;
    for (const item of items) {
        const span = (item.seconds / total) * Math.PI * 2;
        const end = start + span;
        if (angleRad >= start && angleRad < end) return item;
        start = end;
    }
    return null;
}

function setupDonutInteraction(canvas, tooltipEl, items, geometry) {
    if (!canvas || !tooltipEl) return;
    const hide = () => tooltipEl.setAttribute("hidden", "");
    const show = (html) => {
        tooltipEl.innerHTML = html;
        tooltipEl.removeAttribute("hidden");
    };

    const renderFromPointer = (event) => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        const dx = x - geometry.cx;
        const dy = y - geometry.cy;
        const r = Math.sqrt(dx * dx + dy * dy);
        if (r < geometry.innerR || r > geometry.outerR || !geometry.total) {
            hide();
            return null;
        }

        let angle = Math.atan2(dy, dx);
        // normalize to [-PI/2, 3PI/2)
        while (angle < -Math.PI / 2) angle += Math.PI * 2;
        while (angle >= Math.PI * 3 / 2) angle -= Math.PI * 2;

        const item = pickDonutItem(items, geometry.total, angle);
        if (!item) {
            hide();
            return null;
        }

        const pct = Math.round((item.seconds / geometry.total) * 100);
        show(
            `<div class="tt-title">Info</div>` +
                `<div class="tt-row">` +
                `<span class="tt-swatch" style="background:${item.color}"></span>` +
                `<span class="tt-text">${escapeHtml(item.label)}: ${formatDuration(item.seconds)} (${pct}%)</span>` +
                `</div>`
        );
        return item;
    };

    const onPointerMove = (event) => {
        renderFromPointer(event);
    };

    const onPointerDown = (event) => {
        renderFromPointer(event);
    };

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", hide);
    canvas.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerdown", (event) => {
        if (!tooltipEl.hasAttribute("hidden") && !canvas.contains(event.target)) hide();
    });
}

async function loadDashboardPanels() {
    const donut = document.getElementById("timeDonut");
    const legend = document.getElementById("timeLegend");
    const history = document.getElementById("recentHistory");
    const donutTooltip = document.getElementById("donutTooltip");
    if (!donut || !legend || !history) return;

    const palette = ["#22c58b", "#2d92d6", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6", "#84cc16"];

    try {
        const timeData = await jsonRequest("/api/analytics/course-time");
        const items = (timeData.items || [])
            .filter((x) => x.seconds > 0)
            .slice(0, 7)
            .map((item, idx) => ({ ...item, color: palette[idx % palette.length] }));
        const geometry = drawDonutChart(donut, items) || { cx: donut.width / 2, cy: donut.height / 2, outerR: 0, innerR: 0, total: 0 };
        buildLegend(legend, items);
        if (!items.length) {
            legend.innerHTML = '<div class="muted">Open files/links to start tracking time.</div>';
        }
        if (items.length && donutTooltip) setupDonutInteraction(donut, donutTooltip, items, geometry);
    } catch (_e) {
        legend.innerHTML = '<div class="muted">Unable to load chart.</div>';
    }

    try {
        const historyData = await jsonRequest("/api/history/recent");
        const items = historyData.items || [];
        if (!items.length) {
            history.textContent = "No recent activity yet.";
            return;
        }
        history.innerHTML = "";
        for (const item of items.slice(0, 6)) {
            const row = document.createElement("a");
            row.className = "history-item";
            row.href = item.href;
            const left = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = item.node_name;
            const meta = document.createElement("small");
            meta.textContent = `${item.course_name} · ${String(item.node_type || "").toUpperCase()}`;
            left.append(title, meta);
            const right = document.createElement("span");
            right.innerHTML = "&rsaquo;";
            row.append(left, right);
            history.append(row);
        }
    } catch (_e) {
        history.textContent = "Unable to load history.";
    }
}

loadDashboardPanels();
