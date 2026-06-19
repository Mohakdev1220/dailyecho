/**
 * script.js — Daily Echo
 * Full application logic: Auth, Firestore sync, CRUD, drafts, search,
 * filters, import/export, fullscreen editor, toasts, and more.
 */

import {
  auth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  db,
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from "./firebase.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_KEY       = "dailyecho_draft";
const CACHE_KEY       = "dailyecho_cache";
const DRAFT_INTERVAL  = 4000;
const SEARCH_DEBOUNCE = 250;
const TOAST_DURATION  = 3500;

// ─── Application State ────────────────────────────────────────────────────────

const state = {
  user:           null,
  entries:        [],
  activeTab:      "all",
  searchQuery:    "",
  editingId:      null,
  isFullscreen:   false,
  draftTimer:     null,
  firestoreUnsub: null,
  isOnline:       navigator.onLine,
  lastSync:       null,
};

// ─── DOM References ───────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  // Auth
  googleSignInBtn  : $("googleSignInBtn"),
  authGoogleBtn    : $("authGoogleBtn"),
  signOutBtn       : $("signOutBtn"),
  userName         : $("userName"),
  userAvatar       : $("userAvatar"),
  userState        : $("userState"),
  syncDot          : $("syncDot"),
  syncText         : $("syncText"),
  accountBtn       : $("accountBtn"),
  profileMenu      : $("profileMenu"),
  guestBtn         : $("guestBtn"),

  // Entry form
  entryForm        : $("entryForm"),
  entryType        : $("entryType"),
  entryTitle       : $("entryTitle"),
  entryDate        : $("entryDate"),
  entryDescription : $("entryDescription"),
  saveEntryBtn     : $("saveEntryBtn"),
  addEntryBtn      : $("addEntryBtn"),
  fabBtn           : $("fabBtn"),
  discardBtn       : $("discardBtn"),
  titleCount       : $("titleCount"),
  descCount        : $("descCount"),

  // Modal kicker (title changes for edit vs new)
  entryModalKicker : $("entryModalKicker"),
  entryModalTitle  : $("entryModalTitle"),

  // Grid & template
  entryGrid          : $("entryGrid"),
  entryCardTemplate  : $("entryCardTemplate"),
  emptyState         : $("emptyState"),

  // Search
  searchInput      : $("searchInput"),

  // Sidebar counters (sidebar nav-count spans)
  countAll         : $("countAll"),
  countNotes       : $("countNotes"),
  countMemories    : $("countMemories"),
  countDeleted     : $("countDeleted"),

  // Stats strip (main area)
  statAll          : $("statAll"),
  statNotes        : $("statNotes"),
  statMemories     : $("statMemories"),
  statDeleted      : $("statDeleted"),

  // Import / Export
  exportJsonBtn    : $("exportJsonBtn"),
  exportTxtBtn     : $("exportTxtBtn"),
  importBtn        : $("importBtn"),
  processImportBtn : $("processImportBtn"),
  importFileInput  : $("importFileInput"),
  importFileName   : $("importFileName"),
  cancelImportBtn  : $("cancelImportBtn"),

  // Modals
  entryOverlay     : $("entryOverlay"),
  authOverlay      : $("authOverlay"),
  importOverlay    : $("importOverlay"),
  closeModalBtn    : $("closeModalBtn"),
  closeAuthBtn     : $("closeAuthBtn"),
  closeImportBtn   : $("closeImportBtn"),

  // Misc
  deleteAllBtn     : $("deleteAllBtn"),
  fullscreenBtn    : $("fullscreenBtn"),
  toastWrap        : $("toastWrap"),

  // Mobile sidebar
  sidebarToggle    : $("sidebarToggle"),
  sidebar          : $("sidebar"),
  sidebarBackdrop  : $("sidebarBackdrop"),
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function genId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  let d;
  if (value?.toDate) {
    d = value.toDate();
  } else if (typeof value === "string" || typeof value === "number") {
    // FIX: date-only strings like "2024-06-19" are parsed as UTC by Date().
    // Appending T00:00:00 forces local time parsing so the displayed date is correct.
    d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(value + "T00:00:00")
      : new Date(value);
  } else {
    return "";
  }
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("localStorage write failed:", e);
  }
}

function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ─── Toast System ─────────────────────────────────────────────────────────────

function toast(message, type = "info") {
  if (!dom.toastWrap) return;
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", "alert");
  el.textContent = message;
  dom.toastWrap.appendChild(el);

  // Double rAF ensures transition triggers after paint
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("toast--visible")));

  setTimeout(() => {
    el.classList.remove("toast--visible");
    el.addEventListener("transitionend", () => el.remove(), { once: true });
    // Fallback remove in case transition never fires
    setTimeout(() => el.remove(), 500);
  }, TOAST_DURATION);
}

// ─── Sync Status ──────────────────────────────────────────────────────────────

function setSyncStatus(status) {
  const labels = { synced: "Synced", syncing: "Syncing…", offline: "Offline", error: "Sync error" };
  if (dom.syncDot)  dom.syncDot.dataset.status = status;
  if (dom.syncText) dom.syncText.textContent   = labels[status] || status;
}

function updateOnlineStatus() {
  state.isOnline = navigator.onLine;
  if (!state.user) setSyncStatus(navigator.onLine ? "offline" : "offline");
  else setSyncStatus(navigator.onLine ? "synced" : "offline");
}

// ─── Cache ────────────────────────────────────────────────────────────────────

function saveCache(entries) { lsSet(CACHE_KEY, entries); }
function loadCache()        { return lsGet(CACHE_KEY, []); }

// ─── Draft System ─────────────────────────────────────────────────────────────

function saveDraft() {
  const draft = {
    type        : dom.entryType?.value        || "note",
    title       : dom.entryTitle?.value       || "",
    date        : dom.entryDate?.value        || "",
    description : dom.entryDescription?.value || "",
    editingId   : state.editingId,
    savedAt     : Date.now(),
  };
  lsSet(DRAFT_KEY, draft);
  updateCharCounts();
}

function clearDraft() { lsRemove(DRAFT_KEY); }

function startDraftTimer() {
  stopDraftTimer();
  state.draftTimer = setInterval(saveDraft, DRAFT_INTERVAL);
}

function stopDraftTimer() {
  if (state.draftTimer) { clearInterval(state.draftTimer); state.draftTimer = null; }
}

function recoverDraft() {
  const draft = lsGet(DRAFT_KEY, null);
  if (!draft) return;

  // Only recover if draft has real content — not just a date/type
  const hasRealContent = (draft.title || "").trim() || (draft.description || "").trim();
  if (!hasRealContent) {
    clearDraft(); // wipe empty/stale drafts silently
    return;
  }

  // Don't auto-open modal — just show a toast the user can act on
  const ago = Math.round((Date.now() - draft.savedAt) / 60000);
  const msg = `Unsaved draft found (${ago < 1 ? "just now" : ago + "m ago"}). Click to restore.`;

  const el = document.createElement("div");
  el.className = "toast toast--info";
  el.setAttribute("role", "alert");
  el.style.cursor = "pointer";
  el.innerHTML = `📝 ${msg}`;
  dom.toastWrap?.appendChild(el);

  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("toast--visible")));

  // Clicking the toast opens the draft
  el.addEventListener("click", () => {
    dom.entryType.value        = draft.type        || "note";
    dom.entryTitle.value       = draft.title       || "";
    dom.entryDate.value        = draft.date        || todayISO();
    dom.entryDescription.value = draft.description || "";
    state.editingId             = draft.editingId  || null;
    openEntryModal();
    el.remove();
  });

  // Auto-dismiss after 8 seconds
  setTimeout(() => {
    el.classList.remove("toast--visible");
    setTimeout(() => el.remove(), 500);
  }, 8000);
}

// ─── Char Counters ────────────────────────────────────────────────────────────

function updateCharCounts() {
  if (dom.titleCount && dom.entryTitle) {
    dom.titleCount.textContent = `${dom.entryTitle.value.length} / 45`;
  }
  if (dom.descCount && dom.entryDescription) {
    dom.descCount.textContent = `${dom.entryDescription.value.length} / 1000`;
  }
}

// ─── Firestore Helpers ────────────────────────────────────────────────────────

function entriesCol(uid) {
  return collection(db, "users", uid, "entries");
}

function entryDocRef(uid, entryId) {
  return doc(db, "users", uid, "entries", entryId);
}

// ─── Firestore CRUD ───────────────────────────────────────────────────────────

async function firestoreSave(entry) {
  if (!state.user) return;
  setSyncStatus("syncing");
  try {
    await setDoc(entryDocRef(state.user.uid, entry.id), entry, { merge: true });
    state.lastSync = new Date();
    setSyncStatus("synced");
  } catch (err) {
    console.error("Firestore save error:", err);
    setSyncStatus("error");
    toast("Failed to save to cloud. Check your connection.", "error");
    throw err;
  }
}

async function firestoreDelete(entryId) {
  if (!state.user) return;
  setSyncStatus("syncing");
  try {
    await deleteDoc(entryDocRef(state.user.uid, entryId));
    state.lastSync = new Date();
    setSyncStatus("synced");
  } catch (err) {
    console.error("Firestore delete error:", err);
    setSyncStatus("error");
    toast("Failed to delete from cloud.", "error");
    throw err;
  }
}

// ─── Realtime Listener ────────────────────────────────────────────────────────

function startFirestoreListener(uid) {
  if (state.firestoreUnsub) {
    state.firestoreUnsub();
    state.firestoreUnsub = null;
  }
  setSyncStatus("syncing");

  const q = query(entriesCol(uid), orderBy("createdAt", "desc"));

  state.firestoreUnsub = onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snapshot) => {
      const entries = [];
      snapshot.forEach((d) => entries.push({ id: d.id, ...d.data() }));
      state.entries = entries;
      saveCache(entries);
      setSyncStatus(snapshot.metadata.hasPendingWrites ? "syncing" : "synced");
      state.lastSync = new Date();
      renderEntries();
      updateCounters();
    },
    (err) => {
      console.error("Firestore snapshot error:", err);
      setSyncStatus("error");
      toast("Sync error — working from local cache.", "warning");
      state.entries = loadCache();
      renderEntries();
      updateCounters();
    }
  );
}

function stopFirestoreListener() {
  if (state.firestoreUnsub) {
    state.firestoreUnsub();
    state.firestoreUnsub = null;
  }
}

// ─── Entry Operations ─────────────────────────────────────────────────────────

async function saveEntry(formData) {
  const now = new Date().toISOString();
  // FIX: capture editingId BEFORE resetting state.editingId later
  const currentEditingId = state.editingId;
  let entry;

  if (currentEditingId) {
    const existing = state.entries.find((e) => e.id === currentEditingId);
    if (!existing) { toast("Entry not found.", "error"); return; }
    entry = { ...existing, ...formData, updatedAt: now, draft: false };
  } else {
    entry = {
      id        : genId(),
      ...formData,
      createdAt : now,
      updatedAt : now,
      deleted   : false,
      deletedAt : null,
      draft     : false,
      pinned    : false,
    };
  }

  // Optimistic local update
  if (currentEditingId) {
    state.entries = state.entries.map((e) => e.id === entry.id ? entry : e);
  } else {
    state.entries = [entry, ...state.entries];
  }
  saveCache(state.entries);

  // FIX: toast message must be built BEFORE clearing state.editingId
  const successMsg = currentEditingId ? "Entry updated." : "Entry saved.";

  clearDraft();
  state.editingId = null;
  closeEntryModal();
  renderEntries();
  updateCounters();
  toast(successMsg, "success");

  if (state.user) {
    await firestoreSave(entry).catch(() => {});
  }
}

async function softDeleteEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const updated = {
    ...entry,
    deleted   : true,
    deletedAt : new Date().toISOString(),
    updatedAt : new Date().toISOString(),
  };
  state.entries = state.entries.map((e) => e.id === id ? updated : e);
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast("Entry moved to Trash.", "info");
  if (state.user) await firestoreSave(updated).catch(() => {});
}

async function restoreEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const updated = {
    ...entry,
    deleted   : false,
    deletedAt : null,
    updatedAt : new Date().toISOString(),
  };
  state.entries = state.entries.map((e) => e.id === id ? updated : e);
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast("Entry restored.", "success");
  if (state.user) await firestoreSave(updated).catch(() => {});
}

async function permanentDeleteEntry(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast("Entry permanently deleted.", "warning");
  if (state.user) await firestoreDelete(id).catch(() => {});
}

async function deleteAllDeletedEntries() {
  const toDelete = state.entries.filter((e) => e.deleted);
  if (!toDelete.length) { toast("Trash is already empty.", "info"); return; }
  state.entries = state.entries.filter((e) => !e.deleted);
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast(`${toDelete.length} entr${toDelete.length === 1 ? "y" : "ies"} permanently deleted.`, "warning");
  if (state.user) {
    try {
      setSyncStatus("syncing");
      for (const chunk of chunkArray(toDelete, 500)) {
        const batch = writeBatch(db);
        chunk.forEach((e) => batch.delete(entryDocRef(state.user.uid, e.id)));
        await batch.commit();
      }
      setSyncStatus("synced");
    } catch (err) {
      console.error("Batch delete error:", err);
      setSyncStatus("error");
      toast("Cloud delete failed.", "error");
    }
  }
}

async function deleteAllActiveEntries() {
  const active = state.entries.filter((e) => !e.deleted);
  if (!active.length) { toast("No entries to delete.", "info"); return; }
  const now = new Date().toISOString();
  const updated = active.map((e) => ({ ...e, deleted: true, deletedAt: now, updatedAt: now }));
  state.entries = [...state.entries.filter((e) => e.deleted), ...updated];
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast(`${updated.length} entr${updated.length === 1 ? "y" : "ies"} moved to Trash.`, "warning");
  if (state.user) {
    try {
      setSyncStatus("syncing");
      for (const chunk of chunkArray(updated, 500)) {
        const batch = writeBatch(db);
        chunk.forEach((e) => batch.set(entryDocRef(state.user.uid, e.id), e, { merge: true }));
        await batch.commit();
      }
      setSyncStatus("synced");
    } catch (err) {
      console.error("Batch soft-delete error:", err);
      setSyncStatus("error");
      toast("Cloud update failed.", "error");
    }
  }
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function getFilteredEntries() {
  let list = [...state.entries];
  switch (state.activeTab) {
    case "notes":    list = list.filter((e) => !e.deleted && e.type === "note");   break;
    case "memories": list = list.filter((e) => !e.deleted && e.type === "memory"); break;
    case "deleted":  list = list.filter((e) => e.deleted);                         break;
    default:         list = list.filter((e) => !e.deleted);
  }
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(
      (e) => (e.title || "").toLowerCase().includes(q) || (e.description || "").toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  return list;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderEntries() {
  if (!dom.entryGrid) return;

  // Remove existing cards but NOT the static emptyState div
  dom.entryGrid.querySelectorAll(".entry-card").forEach((el) => el.remove());
  // Also remove any dynamically created empty-state paragraphs from previous renders
  dom.entryGrid.querySelectorAll("p.empty-state").forEach((el) => el.remove());

  const filtered = getFilteredEntries();

 // Toggle empty state
  if (dom.emptyState) {
    if (filtered.length === 0) {
      dom.emptyState.style.display = "flex";
      const titleEl = dom.emptyState.querySelector(".empty-title");
      const subEl   = dom.emptyState.querySelector(".empty-sub");
      if (state.searchQuery) {
        if (titleEl) titleEl.textContent = "No results found";
        if (subEl)   subEl.textContent   = `Nothing matched "${state.searchQuery}".`;
      } else {
        const msgs = {
          all      : ["Nothing here yet",    "Create your first note or memory."],
          notes    : ["No notes yet",         "Start writing."],
          memories : ["No memories yet",      "Save your first memory."],
          deleted  : ["Trash is empty",       "Deleted entries appear here."],
        };
        const [title, sub] = msgs[state.activeTab] || msgs.all;
        if (titleEl) titleEl.textContent = title;
        if (subEl)   subEl.textContent   = sub;
      }
      return;
    } else {
      dom.emptyState.style.display = "none";
    }
  }
  const fragment = document.createDocumentFragment();
  filtered.forEach((entry) => {
    const card = buildEntryCard(entry);
    if (card) fragment.appendChild(card);
  });
  dom.entryGrid.appendChild(fragment);
}

function buildEntryCard(entry) {
  if (!dom.entryCardTemplate) return null;
  const tmpl = dom.entryCardTemplate.content.cloneNode(true);
  // FIX: querySelector on a DocumentFragment doesn't work — get the element first
  const card = tmpl.firstElementChild;
  if (!card) return null;

  card.dataset.id   = entry.id;
  card.dataset.type = entry.type || "note";
  if (entry.deleted) card.dataset.deleted = "true";
  if (entry.pinned)  card.dataset.pinned  = "true";

  setCardField(card, "[data-field='title']",       entry.title       || "Untitled");
  setCardField(card, "[data-field='description']", entry.description || "");
  setCardField(card, "[data-field='type']",        entry.type        || "note");
  setCardField(card, "[data-field='date']",        formatDate(entry.entryDate || entry.createdAt));

  const statusEl = card.querySelector("[data-field='status']");
  if (statusEl) {
    statusEl.textContent       = entry.deleted ? "deleted" : (entry.draft ? "draft" : entry.type);
    statusEl.dataset.status    = entry.deleted ? "deleted" : entry.type;
  }

  // Show/hide buttons based on deleted state
  toggleCardButton(card, "[data-action='edit']",           !entry.deleted);
  toggleCardButton(card, "[data-action='delete']",         !entry.deleted);
  toggleCardButton(card, "[data-action='restore']",        !!entry.deleted);
  toggleCardButton(card, "[data-action='delete-forever']", !!entry.deleted);

  return card;
}

function setCardField(card, selector, text) {
  const el = card.querySelector(selector);
  if (el) el.textContent = text;
}

function toggleCardButton(card, selector, visible) {
  const el = card.querySelector(selector);
  if (el) el.hidden = !visible;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

function updateCounters() {
  const all      = state.entries.filter((e) => !e.deleted).length;
  const notes    = state.entries.filter((e) => !e.deleted && e.type === "note").length;
  const memories = state.entries.filter((e) => !e.deleted && e.type === "memory").length;
  const deleted  = state.entries.filter((e) => e.deleted).length;

  // Sidebar nav counts
  if (dom.countAll)      dom.countAll.textContent      = all;
  if (dom.countNotes)    dom.countNotes.textContent    = notes;
  if (dom.countMemories) dom.countMemories.textContent = memories;
  if (dom.countDeleted)  dom.countDeleted.textContent  = deleted;

  // FIX: HTML has statAll/statNotes/statMemories/statDeleted in the stats strip
  // The original script only updated countAll etc. — the stats strip was never updating.
  if (dom.statAll)      dom.statAll.textContent      = all;
  if (dom.statNotes)    dom.statNotes.textContent    = notes;
  if (dom.statMemories) dom.statMemories.textContent = memories;
  if (dom.statDeleted)  dom.statDeleted.textContent  = deleted;
}

// ─── Modal Helpers ────────────────────────────────────────────────────────────

function openEntryModal() {
  if (!dom.entryOverlay) return;
  dom.entryOverlay.hidden = false;
  dom.entryOverlay.setAttribute("aria-hidden", "false");
  updateCharCounts();
  // FIX: defer focus so modal is rendered before focus attempt
  setTimeout(() => dom.entryTitle?.focus(), 50);
  startDraftTimer();
}

function closeEntryModal() {
  if (!dom.entryOverlay) return;
  // Exit fullscreen if active
  if (state.isFullscreen) {
    state.isFullscreen = false;
    dom.entryOverlay.classList.remove("fullscreen");
  }
  dom.entryOverlay.hidden = true;
  dom.entryOverlay.setAttribute("aria-hidden", "true");
  stopDraftTimer();
  // Only save draft if there is actual content worth keeping
  const hasContent = dom.entryTitle?.value.trim() || dom.entryDescription?.value.trim();
  if (hasContent) {
    saveDraft();
  } else {
    clearDraft();
  }
}

function openAuthModal() {
  if (!dom.authOverlay) return;
  dom.authOverlay.hidden = false;
  dom.authOverlay.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  if (!dom.authOverlay) return;
  dom.authOverlay.hidden = true;
  dom.authOverlay.setAttribute("aria-hidden", "true");
}

function openImportModal() {
  if (!dom.importOverlay) return;
  dom.importOverlay.hidden = false;
  dom.importOverlay.setAttribute("aria-hidden", "false");
}

function closeImportModal() {
  if (!dom.importOverlay) return;
  dom.importOverlay.hidden = true;
  dom.importOverlay.setAttribute("aria-hidden", "true");
  if (dom.importFileInput) dom.importFileInput.value = "";
  if (dom.importFileName)  dom.importFileName.textContent = "Choose file or drag here";
}

function openNewEntryForm() {
  state.editingId = null;
  if (dom.entryType)        dom.entryType.value        = "note";
  if (dom.entryTitle)       dom.entryTitle.value       = "";
  if (dom.entryDate)        dom.entryDate.value        = todayISO();
  if (dom.entryDescription) dom.entryDescription.value = "";
  if (dom.saveEntryBtn)     dom.saveEntryBtn.textContent = "Save entry";
  if (dom.entryModalKicker) dom.entryModalKicker.textContent = "New entry";
  if (dom.entryModalTitle)  dom.entryModalTitle.textContent  = "What's on your mind?";
  closeSidebar(); // close sidebar on mobile when opening form
  openEntryModal();
}

function openEditEntryForm(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  state.editingId = id;
  if (dom.entryType)        dom.entryType.value        = entry.type        || "note";
  if (dom.entryTitle)       dom.entryTitle.value       = entry.title       || "";
  if (dom.entryDate)        dom.entryDate.value        = entry.entryDate   || todayISO();
  if (dom.entryDescription) dom.entryDescription.value = entry.description || "";
  if (dom.saveEntryBtn)     dom.saveEntryBtn.textContent = "Update entry";
  if (dom.entryModalKicker) dom.entryModalKicker.textContent = "Edit entry";
  if (dom.entryModalTitle)  dom.entryModalTitle.textContent  = entry.title || "Edit";
  openEntryModal();
}

// ─── Sidebar (mobile) ────────────────────────────────────────────────────────

function openSidebar() {
  dom.sidebar?.classList.add("open");
  dom.sidebarBackdrop?.classList.add("open");
  dom.sidebarBackdrop?.removeAttribute("aria-hidden");
  dom.sidebarToggle?.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  dom.sidebar?.classList.remove("open");
  dom.sidebarBackdrop?.classList.remove("open");
  dom.sidebarBackdrop?.setAttribute("aria-hidden", "true");
  dom.sidebarToggle?.setAttribute("aria-expanded", "false");
}

function toggleSidebar() {
  const isOpen = dom.sidebar?.classList.contains("open");
  isOpen ? closeSidebar() : openSidebar();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function googleSignIn() {
  closeProfileMenu();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
    closeAuthModal();
    toast("Signed in successfully.", "success");
  } catch (err) {
    if (err.code !== "auth/popup-closed-by-user") {
      console.error("Sign-in error:", err);
      toast("Sign-in failed. Please try again.", "error");
    }
  }
}

async function handleSignOut() {
  closeProfileMenu();
  // Guard: do nothing if no user is signed in
  if (!state.user) {
    toast("You are not signed in.", "warning");
    return;
  }
  try {
    stopFirestoreListener();
    await signOut(auth);
    state.user    = null;
    state.entries = loadCache();
    renderEntries();
    updateCounters();
    updateAuthUI(null);
    toast("Signed out.", "info");
  } catch (err) {
    console.error("Sign-out error:", err);
    toast("Sign-out failed.", "error");
  }
}

function updateAuthUI(user) {
  if (user) {
    if (dom.userName)  dom.userName.textContent  = user.displayName || "User";
    if (dom.userState) dom.userState.textContent = "Signed in";

    // FIX: userAvatar in this HTML is a div, not an img — show initials or photo via CSS
    if (dom.userAvatar) {
      if (user.photoURL) {
        dom.userAvatar.style.backgroundImage = `url('${user.photoURL}')`;
        dom.userAvatar.style.backgroundSize  = "cover";
        dom.userAvatar.textContent = "";
      } else {
        dom.userAvatar.style.backgroundImage = "";
        // Show initials
        const initials = (user.displayName || "U")
          .split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
        dom.userAvatar.textContent = initials;
      }
    }

    if (dom.signOutBtn)      dom.signOutBtn.hidden      = false;
    if (dom.googleSignInBtn) dom.googleSignInBtn.hidden = true;
    setSyncStatus("syncing");
  } else {
    if (dom.userName)  dom.userName.textContent  = "Guest";
    if (dom.userState) dom.userState.textContent = "Local mode";
    if (dom.userAvatar) {
      dom.userAvatar.style.backgroundImage = "";
      dom.userAvatar.textContent = "ME";
    }
    if (dom.signOutBtn)      dom.signOutBtn.hidden      = true;
    if (dom.googleSignInBtn) dom.googleSignInBtn.hidden = false;
    setSyncStatus("offline");
  }
}

// ─── Profile dropdown ────────────────────────────────────────────────────────

function toggleProfileMenu() {
  if (!dom.profileMenu) return;
  const isHidden = dom.profileMenu.hidden;
  dom.profileMenu.hidden = !isHidden;
  dom.accountBtn?.setAttribute("aria-expanded", String(isHidden));
}

function closeProfileMenu() {
  if (!dom.profileMenu) return;
  dom.profileMenu.hidden = true;
  dom.accountBtn?.setAttribute("aria-expanded", "false");
}

// ─── Export ───────────────────────────────────────────────────────────────────

function exportJSON() {
  closeProfileMenu();
  const data = { app: "Daily Echo", exported: new Date().toISOString(), version: 1, entries: state.entries };
  downloadFile(JSON.stringify(data, null, 2), `daily-echo-backup-${todayISO()}.json`, "application/json");
  toast("JSON backup downloaded.", "success");
}

function exportTXT() {
  closeProfileMenu();
  const active = state.entries.filter((e) => !e.deleted);
  if (!active.length) { toast("Nothing to export.", "info"); return; }
  const lines = active.map((e) => {
    const sep = "─".repeat(48);
    return [sep, `Type  : ${e.type}`, `Title : ${e.title || "Untitled"}`,
      `Date  : ${e.entryDate || formatDate(e.createdAt)}`, ``, e.description || "(no content)"].join("\n");
  });
  downloadFile(
    `Daily Echo — Export ${new Date().toLocaleString()}\n\n` + lines.join("\n\n"),
    `daily-echo-${todayISO()}.txt`, "text/plain"
  );
  toast("TXT export downloaded.", "success");
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ─── Import ───────────────────────────────────────────────────────────────────

async function processImport() {
  const file = dom.importFileInput?.files?.[0];
  if (!file) { toast("Select a JSON file first.", "warning"); return; }

  let raw;
  try   { raw = await file.text(); }
  catch { toast("Could not read file.", "error"); return; }

  let parsed;
  try   { parsed = JSON.parse(raw); }
  catch { toast("Invalid JSON file.", "error"); return; }

  const incoming = Array.isArray(parsed) ? parsed : Array.isArray(parsed.entries) ? parsed.entries : null;
  if (!incoming) { toast("JSON structure not recognised.", "error"); return; }

  const valid = incoming.filter((e) => e && typeof e === "object" && e.id && e.type);
  if (!valid.length) { toast("No valid entries found in file.", "warning"); return; }

  const existingIds = new Set(state.entries.map((e) => e.id));
  const newEntries  = valid.filter((e) => !existingIds.has(e.id));

  if (!newEntries.length) {
    toast("All entries already exist — nothing imported.", "info");
    closeImportModal();
    return;
  }

  state.entries = [...newEntries, ...state.entries];
  saveCache(state.entries);
  renderEntries();
  updateCounters();
  toast(`Imported ${newEntries.length} new entr${newEntries.length === 1 ? "y" : "ies"}.`, "success");
  closeImportModal();

  if (state.user) {
    try {
      setSyncStatus("syncing");
      for (const chunk of chunkArray(newEntries, 500)) {
        const batch = writeBatch(db);
        chunk.forEach((e) => batch.set(entryDocRef(state.user.uid, e.id), e, { merge: true }));
        await batch.commit();
      }
      setSyncStatus("synced");
    } catch (err) {
      console.error("Import upload error:", err);
      setSyncStatus("error");
      toast("Saved locally; cloud upload failed.", "warning");
    }
  }
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────

function toggleFullscreen() {
  state.isFullscreen = !state.isFullscreen;
  dom.entryOverlay?.classList.toggle("fullscreen", state.isFullscreen);
  if (dom.fullscreenBtn) {
    dom.fullscreenBtn.setAttribute("aria-label",   state.isFullscreen ? "Exit fullscreen" : "Toggle fullscreen");
    dom.fullscreenBtn.setAttribute("aria-pressed", String(state.isFullscreen));
  }
  toast(state.isFullscreen ? "Fullscreen — press Esc to exit." : "Fullscreen off.", "info");
}

// ─── Search ───────────────────────────────────────────────────────────────────

let searchTimer = null;

function handleSearch(value) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = value.trim();
    renderEntries();
  }, SEARCH_DEBOUNCE);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Sync both tab sets ───────────────────────────────────────────────────────
// FIX: HTML has TWO tab groups — sidebar .nav-item and mobile .tab-btn
// Both need to stay in sync when either is clicked.

function setActiveTab(tab) {
  state.activeTab = tab;

  // Sidebar nav items
  document.querySelectorAll(".nav-item[data-tab]").forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  // Mobile tab buttons
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });

  renderEntries();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function bindEvents() {
  // Auth
  dom.googleSignInBtn?.addEventListener("click", googleSignIn);
  dom.authGoogleBtn?.addEventListener("click",   googleSignIn);
  dom.signOutBtn?.addEventListener("click",      handleSignOut);
  // FIX: guestBtn just closes auth modal — it had no listener before
  dom.guestBtn?.addEventListener("click",        closeAuthModal);

  // Profile menu toggle
  dom.accountBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleProfileMenu();
  });

  // Close profile menu when clicking outside
  document.addEventListener("click", (e) => {
    if (dom.profileMenu && !dom.profileMenu.hidden &&
        !dom.profileMenu.contains(e.target) &&
        e.target !== dom.accountBtn) {
      closeProfileMenu();
    }
  });

  // New entry triggers
  dom.addEntryBtn?.addEventListener("click", openNewEntryForm);
  dom.fabBtn?.addEventListener("click",      openNewEntryForm);

  // Entry form submit
  dom.entryForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = dom.entryTitle?.value.trim();
    if (!title) { toast("Please add a title.", "warning"); dom.entryTitle?.focus(); return; }

    const formData = {
      type        : dom.entryType?.value               || "note",
      title,
      entryDate   : dom.entryDate?.value               || todayISO(),
      description : dom.entryDescription?.value.trim() || "",
    };

    if (dom.saveEntryBtn) dom.saveEntryBtn.disabled = true;
    try   { await saveEntry(formData); }
    finally { if (dom.saveEntryBtn) dom.saveEntryBtn.disabled = false; }
  });

  // Discard / cancel button
  dom.discardBtn?.addEventListener("click", () => {
    const hasInput = dom.entryTitle?.value || dom.entryDescription?.value;
    if (hasInput && !confirm("Discard unsaved changes?")) return;
    state.editingId = null;
    clearDraft();
    closeEntryModal();
  });

  // Entry grid — delegated card button clicks
  dom.entryGrid?.addEventListener("click", async (e) => {
    const btn  = e.target.closest("[data-action]");
    const card = e.target.closest("[data-id]");
    if (!btn || !card) return;
    const id     = card.dataset.id;
    const action = btn.dataset.action;
    switch (action) {
      case "edit":
        openEditEntryForm(id);
        break;
      case "delete":
        await softDeleteEntry(id);
        break;
      case "restore":
        await restoreEntry(id);
        break;
      case "delete-forever":
        if (confirm("Permanently delete this entry? This cannot be undone."))
          await permanentDeleteEntry(id);
        break;
    }
  });

  // FIX: bind BOTH sidebar nav-items AND mobile tab-btns to setActiveTab
  document.querySelectorAll(".nav-item[data-tab], .tab-btn[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setActiveTab(btn.dataset.tab);
      closeSidebar(); // close mobile sidebar after picking a tab
    });
  });

  // Search
  dom.searchInput?.addEventListener("input", (e) => handleSearch(e.target.value));

  // Delete all
  dom.deleteAllBtn?.addEventListener("click", async () => {
    const isDeleted = state.activeTab === "deleted";
    const msg = isDeleted
      ? "Permanently delete ALL items in Trash? This cannot be undone."
      : "Move ALL active entries to Trash?";
    if (!confirm(msg)) return;
    isDeleted ? await deleteAllDeletedEntries() : await deleteAllActiveEntries();
  });

  // Fullscreen
  dom.fullscreenBtn?.addEventListener("click", toggleFullscreen);

  // Export
  dom.exportJsonBtn?.addEventListener("click", exportJSON);
  dom.exportTxtBtn?.addEventListener("click",  exportTXT);

  // Import
  dom.importBtn?.addEventListener("click", () => { closeProfileMenu(); openImportModal(); });
  dom.processImportBtn?.addEventListener("click", processImport);
  dom.cancelImportBtn?.addEventListener("click",  closeImportModal);

  // FIX: importFileInput — show filename when file is chosen
  dom.importFileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (dom.importFileName) {
      dom.importFileName.textContent = file ? file.name : "Choose file or drag here";
    }
  });

  // Modal close buttons
  dom.closeModalBtn?.addEventListener("click", () => {
    const hasInput = dom.entryTitle?.value || dom.entryDescription?.value;
    if (hasInput && !confirm("Discard unsaved changes?")) return;
    state.editingId = null;
    clearDraft();
    closeEntryModal();
  });
  dom.closeAuthBtn?.addEventListener("click",   closeAuthModal);
  dom.closeImportBtn?.addEventListener("click", closeImportModal);

  // Backdrop click closes modals
  dom.entryOverlay?.addEventListener("click", (e) => {
    if (e.target !== dom.entryOverlay) return;
    const hasInput = dom.entryTitle?.value || dom.entryDescription?.value;
    if (hasInput && !confirm("Discard unsaved changes?")) return;
    state.editingId = null;
    clearDraft();
    closeEntryModal();
  });
  dom.authOverlay?.addEventListener("click",   (e) => { if (e.target === dom.authOverlay)   closeAuthModal(); });
  dom.importOverlay?.addEventListener("click", (e) => { if (e.target === dom.importOverlay) closeImportModal(); });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Escape":
        if (state.isFullscreen) {
          toggleFullscreen();
        } else if (dom.entryOverlay && !dom.entryOverlay.hidden) {
          const hasInput = dom.entryTitle?.value || dom.entryDescription?.value;
          if (!hasInput) { state.editingId = null; closeEntryModal(); }
        } else if (dom.authOverlay   && !dom.authOverlay.hidden)   closeAuthModal();
        else if (dom.importOverlay && !dom.importOverlay.hidden) closeImportModal();
        else if (dom.profileMenu   && !dom.profileMenu.hidden)   closeProfileMenu();
        else closeSidebar();
        break;
      case "n":
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && dom.entryOverlay?.hidden) {
          e.preventDefault();
          openNewEntryForm();
        }
        break;
    }
  });

  // Char counters on typing
  dom.entryTitle?.addEventListener("input",       updateCharCounts);
  dom.entryDescription?.addEventListener("input", updateCharCounts);

  // Draft saving on input
  dom.entryTitle?.addEventListener("input",       saveDraft);
  dom.entryDescription?.addEventListener("input", saveDraft);

  // Online / Offline
  window.addEventListener("online",  updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  // Mobile sidebar toggle
  dom.sidebarToggle?.addEventListener("click",   toggleSidebar);
  dom.sidebarBackdrop?.addEventListener("click", closeSidebar);
}

// ─── Auth State Observer ──────────────────────────────────────────────────────

function initAuth() {
  onAuthStateChanged(auth, (user) => {
    state.user = user;
    updateAuthUI(user);
    if (user) {
      startFirestoreListener(user.uid);
    } else {
      stopFirestoreListener();
      state.entries = loadCache();
      setSyncStatus("offline");
      renderEntries();
      updateCounters();
    }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function init() {
  // Force correct auth UI immediately before Firebase resolves
  // This prevents sign-out button flashing for guests
  if (dom.signOutBtn)      dom.signOutBtn.hidden      = true;
  if (dom.googleSignInBtn) dom.googleSignInBtn.hidden = false;

  // Immediately show cached entries
  state.entries = loadCache();
  renderEntries();
  updateCounters();
  updateOnlineStatus();

  // Wire all events
  bindEvents();

  // Start auth listener
  initAuth();

  // Try to recover any saved draft after a short delay
  setTimeout(recoverDraft, 800);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
