"use strict";
(() => {
  // src/config.ts
  var SUPABASE_URL = "https://iffmcexdegecmbltatao.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_qzbmt8GhToe-F68iOgOyng_xfqJ94ga";
  var DODO_CHECKOUT_PRO_MONTHLY_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr935jMv3nfSDeOrl2Xl?quantity=1";
  var DODO_CHECKOUT_PRO_YEARLY_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr9BmwcfnUNrBaMwLtah?quantity=1";
  var DODO_CHECKOUT_AGENCY_MONTHLY_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr9B8chyxqNlNzs6DHxz?quantity=1";
  var DODO_CHECKOUT_AGENCY_YEARLY_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr9Bx8TbjJIPhG2QFOZz?quantity=1";
  var DODO_CHECKOUT_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr9Ag5PMxsi2iSo2rZBk?quantity=1";
  var DODO_CHECKOUT_ONETIME_URL = "https://checkout.dodopayments.com/buy/pdt_0Nr9XmjAlz7xuJcHhijEZ?quantity=1";

  // src/code.ts
  var MAX_LIST_ITEMS = 5e3;
  var MAX_DELETE_BATCH = 500;
  var MAX_DUP_GROUPS = 200;
  var MAX_DUP_ITEMS = 20;
  var MAX_VARIANT_SETS = 300;
  var MAX_VARIANT_ITEMS = 100;
  var MAX_MAP_ITEMS = 1e3;
  var EMAIL_STORAGE_KEY = "figma-auditor-email";
  var AUTH_STORAGE_KEY = "figma-auditor-auth";
  var AUTH_URL = SUPABASE_URL.replace(/\/+$/, "");
  var AuthRequestError = class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
      this.name = "AuthRequestError";
    }
  };
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isUIIncoming(value) {
    if (!isRecord(value) || typeof value.type !== "string") return false;
    if (value.type === "get-status") return true;
    if (value.type === "auth-submit") {
      return (value.mode === "sign-in" || value.mode === "sign-up") && typeof value.email === "string" && typeof value.password === "string";
    }
    if (value.type === "auth-sign-out") return true;
    if (value.type === "start-scan") {
      return value.email === void 0 || typeof value.email === "string";
    }
    if (value.type === "save-email") return typeof value.email === "string";
    if (value.type === "open-checkout") {
      return (value.product === "pro" || value.product === "agency" || value.product === "onetime") && (value.billing === void 0 || value.billing === "monthly" || value.billing === "yearly");
    }
    if (value.type === "select-component") return typeof value.id === "string";
    if (value.type === "delete-components") {
      return Array.isArray(value.ids) && value.ids.every((id) => typeof id === "string");
    }
    if (value.type === "help-submit" || value.type === "feedback-submit") {
      return typeof value.message === "string" && value.message.trim().length > 0 && value.message.length <= 5e3 && (value.email === void 0 || typeof value.email === "string");
    }
    return false;
  }
  function yieldToFigma() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  function postProgress(step, done, total) {
    figma.ui.postMessage({ type: "scan-progress", step, done, total });
  }
  async function collectNodes() {
    const components = [];
    const instances = [];
    const stack = [];
    const pages = figma.root.children;
    for (let index = pages.length - 1; index >= 0; index -= 1) {
      stack.push({ node: pages[index], page: pages[index].name });
    }
    let done = 0;
    postProgress("read", 0, Math.max(stack.length, 1));
    while (stack.length > 0) {
      const { node, page } = stack.pop();
      done += 1;
      if (node.type === "COMPONENT") components.push({ node, page });
      if (node.type === "INSTANCE") instances.push({ node, page });
      if ("children" in node) {
        const children = node.children;
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({ node: children[index], page });
        }
      }
      if (done % 200 === 0) {
        postProgress("read", done, Math.max(done + stack.length, 1));
        await yieldToFigma();
      }
    }
    postProgress("read", Math.max(done, 1), Math.max(done, 1));
    return { components, instances };
  }
  async function runScan(nodes) {
    const { components, instances } = nodes;
    const uses = /* @__PURE__ */ new Map();
    const usePages = /* @__PURE__ */ new Map();
    postProgress("usage", 0, Math.max(instances.length, 1));
    for (let index = 0; index < instances.length; index += 1) {
      const { node, page } = instances[index];
      const main = node.mainComponent;
      if (main) {
        uses.set(main.id, (uses.get(main.id) ?? 0) + 1);
        let pageCounts = usePages.get(main.id);
        if (!pageCounts) {
          pageCounts = /* @__PURE__ */ new Map();
          usePages.set(main.id, pageCounts);
        }
        pageCounts.set(page, (pageCounts.get(page) ?? 0) + 1);
      }
      if ((index + 1) % 200 === 0) {
        postProgress("usage", index + 1, Math.max(instances.length, 1));
        await yieldToFigma();
      }
    }
    postProgress("usage", Math.max(instances.length, 1), Math.max(instances.length, 1));
    let unusedCount = 0;
    let variantCount = 0;
    const unused = [];
    const map = [];
    const duplicatesByName = /* @__PURE__ */ new Map();
    const variantsById = /* @__PURE__ */ new Map();
    postProgress("dupes", 0, Math.max(components.length, 1));
    for (let index = 0; index < components.length; index += 1) {
      const { node, page } = components[index];
      const count = uses.get(node.id) ?? 0;
      const parent = node.parent;
      const inSet = parent?.type === "COMPONENT_SET";
      const displayName = inSet ? `${parent.name} / ${node.name}` : node.name;
      if (count === 0) {
        unusedCount += 1;
        if (unused.length < MAX_LIST_ITEMS) unused.push({ id: node.id, name: displayName });
      }
      const pageCounts = usePages.get(node.id);
      const usedOn = [];
      pageCounts?.forEach((pageCount, pageName) => usedOn.push({ name: pageName, count: pageCount }));
      usedOn.sort((left, right) => right.count - left.count);
      map.push({ id: node.id, name: displayName, page, uses: count, pages: usedOn.slice(0, 5) });
      if (inSet && parent?.type === "COMPONENT_SET") {
        variantCount += 1;
        let set = variantsById.get(parent.id);
        if (!set) {
          set = { id: parent.id, name: parent.name, page, total: 0, unused: 0, items: [] };
          variantsById.set(parent.id, set);
        }
        set.total += 1;
        if (count === 0) set.unused += 1;
        if (set.items.length < MAX_VARIANT_ITEMS) {
          set.items.push({ id: node.id, name: node.name, uses: count });
        }
      } else {
        const key = node.name.trim().toLowerCase();
        let group = duplicatesByName.get(key);
        if (!group) {
          group = { name: node.name, items: [] };
          duplicatesByName.set(key, group);
        }
        group.items.push({ id: node.id, page, uses: count });
      }
      if ((index + 1) % 200 === 0) {
        postProgress("dupes", index + 1, Math.max(components.length, 1));
        await yieldToFigma();
      }
    }
    postProgress("dupes", Math.max(components.length, 1), Math.max(components.length, 1));
    const duplicates = [];
    duplicatesByName.forEach((group) => {
      if (group.items.length > 1) {
        duplicates.push({
          name: group.name,
          total: group.items.length,
          items: group.items.slice(0, MAX_DUP_ITEMS)
        });
      }
    });
    duplicates.sort((left, right) => right.total - left.total);
    const variants = Array.from(variantsById.values());
    variants.sort((left, right) => right.unused - left.unused || right.total - left.total);
    map.sort((left, right) => right.uses - left.uses || left.name.localeCompare(right.name));
    return {
      componentCount: components.length,
      unusedCount,
      duplicateGroups: duplicates.length,
      variantCount,
      unused,
      duplicates: duplicates.slice(0, MAX_DUP_GROUPS),
      variants: variants.slice(0, MAX_VARIANT_SETS),
      map: map.slice(0, MAX_MAP_ITEMS)
    };
  }
  async function requestScanGate(action, values = {}) {
    const figmaUserId = figma.currentUser?.id;
    if (!figmaUserId) {
      throw new Error("Sign in to Figma to check your free trial and scan this file.");
    }
    if (SUPABASE_URL.includes("YOUR_PROJECT_REF") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")) {
      throw new Error("Account and free trial checks are not configured. Please contact the plugin administrator.");
    }
    const session = await getAuthSession();
    if (!session) throw new Error("Sign in to your account to check your free trial.");
    const email = await figma.clientStorage.getAsync(EMAIL_STORAGE_KEY);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/scan-gate`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `******`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        figma_user_id: figmaUserId,
        email: typeof email === "string" ? email : void 0,
        action,
        ...values
      })
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The trial service returned an unreadable response. Please try again.");
    }
    if (!isRecord(result)) {
      throw new Error("The trial service returned an invalid response. Please try again.");
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        await figma.clientStorage.deleteAsync(AUTH_STORAGE_KEY);
        throw new Error("Your session expired or your email is not verified. Sign in again to continue.");
      }
      if (result.error === "rate_limited") {
        throw new Error("Too many account requests. Please wait a minute and try again.");
      }
      throw new Error("Could not check your free trial. Please try again later.");
    }
    return result;
  }
  async function authRequest(path, body) {
    const response = await fetch(`${AUTH_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The authentication service returned an unreadable response.");
    }
    if (!isRecord(result)) {
      throw new Error("The authentication service returned an invalid response.");
    }
    if (!response.ok) {
      const code = typeof result.error_code === "string" ? result.error_code : "";
      if (code === "email_not_confirmed") {
        throw new AuthRequestError("Please verify your email address, then sign in.", response.status);
      }
      if (code === "invalid_credentials") {
        throw new AuthRequestError("Email or password is incorrect.", response.status);
      }
      const message = typeof result.msg === "string" ? result.msg : typeof result.message === "string" ? result.message : "";
      throw new AuthRequestError(
        message || "Could not authenticate. Check your details and try again.",
        response.status
      );
    }
    return result;
  }
  async function saveAuthSession(result) {
    if (typeof result.access_token !== "string" || typeof result.refresh_token !== "string") {
      return false;
    }
    const expiresIn = typeof result.expires_in === "number" ? result.expires_in : 3600;
    const session = {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: typeof result.expires_at === "number" ? result.expires_at : Math.floor(Date.now() / 1e3) + expiresIn
    };
    await figma.clientStorage.setAsync(AUTH_STORAGE_KEY, session);
    return true;
  }
  async function getAuthSession() {
    const stored = await figma.clientStorage.getAsync(AUTH_STORAGE_KEY);
    if (!isRecord(stored) || typeof stored.access_token !== "string" || typeof stored.refresh_token !== "string" || typeof stored.expires_at !== "number") {
      return null;
    }
    const session = {
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
      expires_at: stored.expires_at
    };
    if (session.expires_at > Math.floor(Date.now() / 1e3) + 60) return session;
    let refreshed;
    try {
      refreshed = await authRequest("token?grant_type=refresh_token", {
        refresh_token: session.refresh_token
      });
    } catch (error) {
      if (!(error instanceof AuthRequestError) || error.status !== 400 && error.status !== 401) {
        throw error;
      }
      await figma.clientStorage.deleteAsync(AUTH_STORAGE_KEY);
      return null;
    }
    if (!refreshed || !await saveAuthSession(refreshed)) {
      await figma.clientStorage.deleteAsync(AUTH_STORAGE_KEY);
      return null;
    }
    return getAuthSession();
  }
  async function postStatus() {
    const session = await getAuthSession();
    if (!session) {
      figma.ui.postMessage({ type: "auth-required" });
      return;
    }
    const status = await requestScanGate("status");
    const email = await figma.clientStorage.getAsync(EMAIL_STORAGE_KEY);
    figma.ui.postMessage({
      type: "status",
      plan: typeof status.plan === "string" ? status.plan : "free",
      free_scans_left: typeof status.free_scans_left === "number" ? status.free_scans_left : null,
      credits: typeof status.credits === "number" ? status.credits : 0,
      plan_expires_at: typeof status.plan_expires_at === "string" ? status.plan_expires_at : null,
      name: "",
      email: typeof email === "string" ? email : null
    });
  }
  async function selectComponent(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.type !== "COMPONENT" && node.type !== "COMPONENT_SET" || node.removed) {
      throw new Error("That component is no longer in this file.");
    }
    let page = node;
    while (page && page.type !== "PAGE") page = page.parent;
    if (page?.type === "PAGE") await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }
  async function collectUsedComponentIds() {
    const used = /* @__PURE__ */ new Set();
    const stack = [...figma.root.children];
    let done = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      done += 1;
      if (node.type === "INSTANCE") {
        const main = node.mainComponent;
        if (main) used.add(main.id);
      }
      if ("children" in node) {
        const children = node.children;
        for (let index = 0; index < children.length; index += 1) {
          stack.push(children[index]);
        }
      }
      if (done % 200 === 0) await yieldToFigma();
    }
    return used;
  }
  async function deleteComponents(ids) {
    const limitedIds = Array.from(new Set(ids)).slice(0, MAX_DELETE_BATCH);
    const unprocessed = Math.max(0, new Set(ids).size - limitedIds.length);
    const used = await collectUsedComponentIds();
    const removed = [];
    let failed = unprocessed;
    for (const id of limitedIds) {
      try {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.removed) {
          removed.push(id);
        } else if (node.type !== "COMPONENT" || used.has(id)) {
          failed += 1;
        } else {
          node.remove();
          removed.push(id);
        }
      } catch {
        failed += 1;
      }
    }
    figma.ui.postMessage({ type: "deleted", ids: removed, failed });
  }
  async function sendSupportMessage(form, message, email) {
    const figmaUserId = figma.currentUser?.id;
    if (!figmaUserId) {
      throw new Error("Could not identify your Figma account. Reopen the plugin while signed in to Figma.");
    }
    if (SUPABASE_URL.includes("YOUR_PROJECT_REF") || SUPABASE_ANON_KEY.includes("YOUR_SUPABASE_ANON_KEY")) {
      throw new Error("Support email is not configured yet. Please contact the plugin administrator.");
    }
    const response = await fetch(`${SUPABASE_URL}/functions/v1/send-support`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        figma_user_id: figmaUserId,
        form,
        message: message.trim(),
        reply_to: email.trim()
      })
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    const errorCode = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string" ? result.error : null;
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error("Too many messages were sent recently. Please wait a minute and try again.");
      }
      if (response.status === 503) {
        throw new Error("Support email is not configured yet. Please contact the plugin administrator.");
      }
      if (errorCode === "invalid_email") {
        throw new Error("Enter a valid email address so support can reply.");
      }
      throw new Error("Your message could not be sent. Please try again later.");
    }
    figma.ui.postMessage({ type: `${form}-sent` });
  }
  figma.showUI(__html__, { width: 1120, height: 650 });
  figma.ui.onmessage = (message) => {
    void (async () => {
      try {
        if (!isUIIncoming(message)) return;
        if (message.type === "get-status") {
          try {
            await postStatus();
          } catch (error) {
            figma.ui.postMessage({
              type: "status-error",
              message: error instanceof Error ? error.message : "Could not check your free trial."
            });
          }
        } else if (message.type === "save-email") {
          await figma.clientStorage.setAsync(EMAIL_STORAGE_KEY, message.email.trim());
          await postStatus();
        } else if (message.type === "auth-submit") {
          const path = message.mode === "sign-in" ? "token?grant_type=password" : "signup";
          const result = await authRequest(path, {
            email: message.email.trim(),
            password: message.password
          });
          if (!await saveAuthSession(result)) {
            figma.ui.postMessage({
              type: "auth-verification-required",
              message: "Check your email to verify your account, then sign in here."
            });
            return;
          }
          figma.ui.postMessage({ type: "auth-success" });
          await postStatus();
        } else if (message.type === "auth-sign-out") {
          await figma.clientStorage.deleteAsync(AUTH_STORAGE_KEY);
          figma.ui.postMessage({ type: "auth-required" });
        } else if (message.type === "start-scan") {
          if (!await getAuthSession()) {
            figma.ui.postMessage({ type: "auth-required" });
            return;
          }
          const nodes = await collectNodes();
          const gate = await requestScanGate("start", {
            component_count: nodes.components.length
          });
          if (gate.allowed !== true) {
            try {
              await postStatus();
            } catch (error) {
              figma.ui.postMessage({
                type: "status-error",
                message: error instanceof Error ? error.message : "Could not refresh your free trial balance."
              });
            }
            figma.ui.postMessage({
              type: "blocked",
              reason: typeof gate.reason === "string" ? gate.reason : "scan_not_allowed",
              max: typeof gate.max === "number" ? gate.max : 100
            });
            return;
          }
          const scanId = gate.scan_id;
          try {
            if (typeof scanId !== "number") {
              throw new Error("Your scan was allowed, but its usage could not be recorded. Please contact support.");
            }
            const result = await runScan(nodes);
            await requestScanGate("complete", {
              scan_id: scanId,
              unused_count: result.unusedCount,
              duplicate_groups: result.duplicateGroups
            });
            figma.ui.postMessage({
              type: "scan-done",
              component_count: result.componentCount,
              unused_count: result.unusedCount,
              duplicate_groups: result.duplicateGroups,
              unused: result.unused,
              duplicates: result.duplicates,
              variants: result.variants,
              map: result.map,
              variant_count: result.variantCount
            });
          } finally {
            try {
              await postStatus();
            } catch (error) {
              figma.ui.postMessage({
                type: "status-error",
                message: error instanceof Error ? error.message : "Could not refresh your free trial balance."
              });
            }
          }
        } else if (message.type === "select-component") {
          await selectComponent(message.id);
        } else if (message.type === "delete-components") {
          await deleteComponents(message.ids);
        } else if (message.type === "open-checkout") {
          const checkoutUrl = message.product === "onetime" ? DODO_CHECKOUT_ONETIME_URL : message.product === "pro" && message.billing === "monthly" ? DODO_CHECKOUT_PRO_MONTHLY_URL : message.product === "pro" && message.billing === "yearly" ? DODO_CHECKOUT_PRO_YEARLY_URL : message.product === "agency" && message.billing === "monthly" ? DODO_CHECKOUT_AGENCY_MONTHLY_URL : message.product === "agency" && message.billing === "yearly" ? DODO_CHECKOUT_AGENCY_YEARLY_URL : DODO_CHECKOUT_URL;
          figma.openExternal(checkoutUrl);
        } else if (message.type === "help-submit" || message.type === "feedback-submit") {
          const form = message.type === "help-submit" ? "help" : "feedback";
          if (!message.email) {
            throw new Error("Enter your email address so support can reply.");
          }
          await sendSupportMessage(form, message.message, message.email);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "The requested action failed.";
        figma.ui.postMessage(
          message && isRecord(message) && message.type === "auth-submit" ? { type: "auth-error", message: errorMessage } : { type: "error", message: errorMessage }
        );
      }
    })();
  };
})();
