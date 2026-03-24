// Render progress comparison for latest vs previous workout
function renderExerciseProgressComparison(workouts, exercisesByWorkout) {
  const progressList = document.getElementById("progressComparisonList");
  if (!progressList) return;

  if (!workouts || workouts.length < 2) {
    progressList.innerHTML = '<li>Brak danych do porównania.</li>';
    return;
  }

  // Sort workouts by date descending
  const sortedWorkouts = [...workouts].sort((a, b) => new Date(b.date) - new Date(a.date));
  const latest = sortedWorkouts[0];
  const previous = sortedWorkouts[1];

  const latestExercises = (exercisesByWorkout[latest.id] || []).reduce((acc, ex) => {
    acc[ex.name] = ex;
    return acc;
  }, {});
  const previousExercises = (exercisesByWorkout[previous.id] || []).reduce((acc, ex) => {
    acc[ex.name] = ex;
    return acc;
  }, {});

  const allExerciseNames = Array.from(new Set([
    ...Object.keys(latestExercises),
    ...Object.keys(previousExercises),
  ]));

  const items = allExerciseNames.map((name) => {
    const latestEx = latestExercises[name];
    const prevEx = previousExercises[name];
    let diff = null;
    let diffText = '-';
    let diffClass = '';

    // Compare by max weight (or total volume if you prefer)
    const getMaxWeight = (ex) => {
      if (!ex || !ex.sets) return NaN;
      let max = NaN;
      try {
        max = Math.max(...ex.sets.map(s => parseFloat(s.weight || 0)));
      } catch {}
      return max;
    };
    const latestWeight = getMaxWeight(latestEx);
    const prevWeight = getMaxWeight(prevEx);
    if (!isNaN(latestWeight) && !isNaN(prevWeight)) {
      diff = latestWeight - prevWeight;
      if (diff > 0) {
        diffText = `+${diff.toFixed(1)} kg↑`;
        diffClass = 'progress-up';
      } else if (diff < 0) {
        diffText = `${diff.toFixed(1)} kg↓`;
        diffClass = 'progress-down';
      } else {
        diffText = '0 kg';
        diffClass = '';
      }
    } else if (!isNaN(latestWeight)) {
      diffText = `${latestWeight.toFixed(1)} kg`;
      diffClass = '';
    }
    return `<li><span>${name}</span> <span class="progress-diff ${diffClass}">${diffText}</span></li>`;
  });

  progressList.innerHTML = items.length ? items.join('') : '<li>Brak danych do porównania.</li>';
}
import {
  auth,
  db,
  storage,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  setDoc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "./firebase.js";

const currentPage = document.body.dataset.page;
let homeHistoryExpanded = false;
let workoutsPageCache = [];
let workoutsExercisesCache = {};
let editingWorkoutId = null;
let dashboardStrengthRange = 30;
let addWorkoutTemplatesCache = [];
let editingTemplateId = null;
const GLOBAL_RANGE_STORAGE_KEY = "dzik-global-range-days";
const GLOBAL_RANGE_OPTIONS = [7, 30, 183, 365];
let globalDataRangeDays = 30;

const DASHBOARD_STRENGTH_RANGE_LABELS = {
  7: "1 tydzień",
  30: "1 miesiąc",
  183: "6 miesięcy",
  365: "1 rok",
};

function getSafeGlobalRangeDays(value) {
  const parsed = Number(value);
  if (GLOBAL_RANGE_OPTIONS.includes(parsed)) {
    return parsed;
  }

  return 30;
}

function getGlobalRangeShortLabel(rangeDays) {
  const labels = {
    7: "1T",
    30: "1M",
    183: "6M",
    365: "1R",
  };

  return labels[rangeDays] || "1M";
}

function syncGlobalRangeFromStorage() {
  try {
    const stored = window.localStorage.getItem(GLOBAL_RANGE_STORAGE_KEY);
    globalDataRangeDays = getSafeGlobalRangeDays(stored);
  } catch (error) {
    globalDataRangeDays = 30;
  }
}

function persistGlobalRange(rangeDays) {
  const safeRange = getSafeGlobalRangeDays(rangeDays);
  globalDataRangeDays = safeRange;

  try {
    window.localStorage.setItem(GLOBAL_RANGE_STORAGE_KEY, String(safeRange));
  } catch (error) {
    console.error("Nie udalo sie zapisac zakresu globalnego:", error);
  }
}

function parseDecimalInput(value) {
  const normalized = String(value == null ? "" : value).replace(",", ".");
  return parseFloat(normalized);
}

function parseSetComboValue(value) {
  const raw = String(value == null ? "" : value)
    .replace(/×/g, "x")
    .replace(/\s+/g, " ")
    .trim();

  const match = raw.match(/^([0-9]+(?:[.,][0-9]+)?)\s*x\s*([0-9]+)$/i);
  if (!match) {
    return { weight: NaN, reps: NaN };
  }

  const weight = parseDecimalInput(match[1]);
  const reps = Number(match[2]);
  return { weight, reps };
}

function formatSetComboValue(weight, reps) {
  const parsedWeight = parseDecimalInput(weight);
  const parsedReps = Number(reps);

  if (!Number.isFinite(parsedWeight) || !Number.isFinite(parsedReps) || parsedReps <= 0) {
    return "";
  }

  return `${String(parsedWeight).replace(".", ",")} x ${parsedReps}`;
}

document.addEventListener("DOMContentLoaded", () => {
  syncGlobalRangeFromStorage();

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches(".set-combo, .template-exercise-weight, .edit-ex-weight")) {
      const raw = target.value;
      const normalized = raw.replace(",", ".");
      if (normalized !== raw) {
        const cursor = target.selectionStart;
        target.value = normalized;
        try {
          target.setSelectionRange(cursor, cursor);
        } catch (_) {}
      }
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user && currentPage !== "login") {
      window.location.href = "login.html";
      return;
    }

    if (user && currentPage === "login") {
      window.location.href = "index.html";
      return;
    }

    try {
      await setupNav(user);

      if (currentPage === "login") {
        initLoginPage();
        return;
      }

      if (currentPage === "home") {
        await initHomePage(user);
      }

      if (currentPage === "dashboard") {
        await initDashboardPage(user);
      }

      if (currentPage === "add-workout") {
        await initAddWorkoutPage(user);
      }

      if (currentPage === "profile") {
        await initProfilePage(user);
      }

      if (currentPage === "profile-edit") {
        await initProfileEditPage(user);
      }

      if (currentPage === "workouts") {
        await initWorkoutsPage(user);
      }
    } catch (error) {
      showError(getFriendlyError(error));
      toggleLoading(false);
      console.error(error);
    }
  });
});

async function setupNav(user) {
  const navUser = document.getElementById("navUser");
  const navUserPhoto = document.getElementById("navUserPhoto");

  if (user) {
    let userProfile = null;
    try {
      userProfile = await getUserProfile(user.uid);
    } catch (error) {
      console.error("Nie udalo sie pobrac profilu do nawigacji:", error);
    }

    if (navUser) {
      navUser.textContent = userProfile?.name || user.email || "";
    }

    if (navUserPhoto) {
      if (userProfile?.photoURL) {
        navUserPhoto.src = userProfile.photoURL;
        navUserPhoto.classList.remove("hidden");
      } else {
        navUserPhoto.removeAttribute("src");
        navUserPhoto.classList.add("hidden");
      }
    }
  } else {
    if (navUser) {
      navUser.textContent = "";
    }

    if (navUserPhoto) {
      navUserPhoto.removeAttribute("src");
      navUserPhoto.classList.add("hidden");
    }
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
        window.location.href = "login.html";
      } catch (error) {
        showError("Nie udalo sie wylogowac.");
        console.error(error);
      }
    });
  }

  let navKey = currentPage;
  if (currentPage === "profile-edit") {
    navKey = "profile";
  }
  if (currentPage === "add-workout") {
    navKey = "workouts";
  }

  const navLinks = document.querySelectorAll(`[data-nav='${navKey}']`);
  navLinks.forEach((link) => link.classList.add("active"));

  setupGlobalRangeToggle();
}

function setupGlobalRangeToggle() {
  if (currentPage === "login") {
    return;
  }

  const topbarInner = document.querySelector(".topbar-inner");
  const userActions = document.querySelector(".user-actions");
  if (!topbarInner) {
    return;
  }

  let toggle = document.getElementById("globalRangeToggle");
  if (!toggle) {
    toggle = document.createElement("div");
    toggle.id = "globalRangeToggle";
    toggle.className = "range-toggle nav-range-toggle";
    toggle.setAttribute("aria-label", "Zakres danych");
    toggle.innerHTML = `<button id="globalRangeBtn" class="range-btn active" type="button" aria-label="Zmień zakres danych"></button>`;

    if (userActions) {
      topbarInner.insertBefore(toggle, userActions);
    } else {
      topbarInner.appendChild(toggle);
    }
  }

  const desktopButton = toggle.querySelector("#globalRangeBtn");

  const mobileNav = document.querySelector(".mobile-bottom-nav");
  let mobileButton = document.getElementById("globalRangeBtnMobile");
  if (mobileNav && !mobileButton) {
    mobileButton = document.createElement("button");
    mobileButton.id = "globalRangeBtnMobile";
    mobileButton.type = "button";
    mobileButton.className = "mobile-bottom-link mobile-range-link";
    mobileButton.setAttribute("aria-label", "Zmien zakres danych");
    mobileNav.appendChild(mobileButton);
  }

  const buttons = [desktopButton, mobileButton].filter(Boolean);
  if (!buttons.length) {
    return;
  }

  const updateRangeButton = () => {
    const shortLabel = getGlobalRangeShortLabel(globalDataRangeDays);
    buttons.forEach((button) => {
      button.textContent = shortLabel;
      button.title = `Zakres danych: ${shortLabel} (kliknij aby zmienic)`;
    });
  };

  updateRangeButton();

  const handleRangeCycle = () => {
    const currentIndex = GLOBAL_RANGE_OPTIONS.indexOf(globalDataRangeDays);
    const nextIndex = currentIndex >= 0
      ? (currentIndex + 1) % GLOBAL_RANGE_OPTIONS.length
      : 0;
    const nextRange = GLOBAL_RANGE_OPTIONS[nextIndex];

    persistGlobalRange(nextRange);
    updateRangeButton();
    window.location.reload();
  };

  buttons.forEach((button) => {
    button.onclick = handleRangeCycle;
  });
}

function initLoginPage() {
  const authForm = document.getElementById("authForm");
  const authToggle = document.getElementById("authToggle");
  const authSubmit = document.getElementById("authSubmit");
  const authSwitchText = document.getElementById("authSwitchText");
  const nameGroup = document.getElementById("nameGroup");
  const nameInput = document.getElementById("name");

  let isRegisterMode = false;

  const applyMode = () => {
    if (isRegisterMode) {
      authSubmit.textContent = "Utworz konto";
      authSwitchText.textContent = "Masz juz konto?";
      authToggle.textContent = "Zaloguj się";
      nameGroup.classList.remove("hidden");
      nameInput.required = true;
    } else {
      authSubmit.textContent = "Zaloguj się";
      authSwitchText.textContent = "Nie masz konta?";
      authToggle.textContent = "Zarejestruj się";
      nameGroup.classList.add("hidden");
      nameInput.required = false;
      nameInput.value = "";
    }
  };

  authToggle.addEventListener("click", () => {
    isRegisterMode = !isRegisterMode;
    hideMessages();
    applyMode();
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessages();

    const email = authForm.email.value.trim();
    const password = authForm.password.value.trim();
    const name = authForm.name.value.trim();

    if (!email || !password) {
      showError("Email i hasło sa wymagane.", "authError");
      return;
    }

    if (isRegisterMode && !name) {
      showError("Podaj imię do rejestracji.", "authError");
      return;
    }

    toggleLoading(true, "authLoading");

    try {
      if (isRegisterMode) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Tworzenie dokumentu użytkownika po rejestracji.
        await setDoc(doc(db, "users", userCredential.user.uid), {
          email,
          name,
          createdAt: serverTimestamp(),
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      showError(getFriendlyError(error), "authError");
      console.error(error);
    } finally {
      toggleLoading(false, "authLoading");
    }
  });

  applyMode();
}

async function initHomePage(user) {
  toggleLoading(true);
  hideMessages();

  const [userProfile, workouts, allWorkoutsResult, allExercisesResult] = await Promise.all([
    getUserProfileSafe(user.uid),
    getUserWorkoutsSafe(user.uid),
    getAllWorkoutsSafe(),
    getAllExercisesSafe(),
  ]);
  const scopedWorkouts = filterWorkoutsByRange(workouts, globalDataRangeDays);
  const scopedWorkoutIds = scopedWorkouts.map((workout) => workout.id);
  const exercisesByWorkout = await getExercisesByWorkoutIds(scopedWorkoutIds);
  const allExercisesByWorkout = indexExercisesByWorkout(allExercisesResult.exercises);
  const weeklyGoal = getWeeklyGoal(userProfile);
  const rankingHasPermission = allWorkoutsResult.hasPermission && allExercisesResult.hasPermission;

  renderHomeHeader(user, userProfile);
  renderUserStatus(scopedWorkouts, weeklyGoal);
  await renderGlobalRanking(allWorkoutsResult.workouts, allExercisesByWorkout, rankingHasPermission, user.uid, globalDataRangeDays);

  renderLastWorkout(scopedWorkouts, exercisesByWorkout);
  renderWorkoutHistory(scopedWorkouts, exercisesByWorkout);

  toggleLoading(false);
}

function renderHomeHeader(user, userProfile) {
  const greetingEl = document.getElementById("homeGreeting");
  const greetingMetaEl = document.getElementById("homeGreetingMeta");
  const homeProfileName = document.getElementById("homeProfileName");
  const homeAvatarPhoto = document.getElementById("homeAvatarPhoto");
  const homeAvatarFallback = document.getElementById("homeAvatarFallback");

  if (!greetingEl || !greetingMetaEl) {
    return;
  }

  const displayName = getDisplayName(user, userProfile);
  greetingEl.textContent = `Cześć ${displayName} 👋`;
  greetingMetaEl.textContent = "Szybki dostęp do Twoich treningów, celu tygodnia i aktywności całej społeczności.";

  if (homeProfileName) {
    homeProfileName.textContent = displayName;
  }

  if (homeAvatarFallback) {
    homeAvatarFallback.textContent = getInitial(displayName);
  }

  if (homeAvatarPhoto) {
    if (userProfile?.photoURL) {
      homeAvatarPhoto.src = userProfile.photoURL;
      homeAvatarPhoto.classList.remove("hidden");
      if (homeAvatarFallback) {
        homeAvatarFallback.classList.add("hidden");
      }
    } else {
      homeAvatarPhoto.removeAttribute("src");
      homeAvatarPhoto.classList.add("hidden");
      if (homeAvatarFallback) {
        homeAvatarFallback.classList.remove("hidden");
      }
    }
  }
}

function renderUserStatus(workouts, weeklyGoal) {
  const lastWorkoutDaysEl = document.getElementById("lastWorkoutDays");
  const lastWorkoutDateEl = document.getElementById("lastWorkoutDate");
  const streakWeeksEl = document.getElementById("streakWeeks");
  const weeklyGoalValueEl = document.getElementById("weeklyGoalValue");
  const weeklyGoalMetaEl = document.getElementById("weeklyGoalMeta");
  const weekProgressTextEl = document.getElementById("weekProgressText");
  const weekProgressBarEl = document.getElementById("weekProgressBar");
  const statusBadgeEl = document.getElementById("statusBadge");
  const statusEmptyEl = document.getElementById("statusEmpty");

  if (
    !lastWorkoutDaysEl ||
    !lastWorkoutDateEl ||
    !streakWeeksEl ||
    !weeklyGoalValueEl ||
    !weeklyGoalMetaEl ||
    !weekProgressTextEl ||
    !weekProgressBarEl ||
    !statusBadgeEl ||
    !statusEmptyEl
  ) {
    return;
  }

  const thisWeekCount = workouts.filter((workout) => isInCurrentWeek(workout.date)).length;
  const streak = calculateWeeklyStreak(workouts, weeklyGoal);
  const progressPercent = Math.min((thisWeekCount / weeklyGoal) * 100, 100);

  weeklyGoalValueEl.textContent = String(weeklyGoal);
  weeklyGoalMetaEl.textContent = `${formatTrainingCount(weeklyGoal)} tygodniowo`;
  weekProgressTextEl.textContent = `${thisWeekCount} / ${weeklyGoal}`;
  weekProgressBarEl.style.width = `${progressPercent}%`;
  streakWeeksEl.textContent = String(streak);

  if (!workouts.length) {
    statusEmptyEl.classList.remove("hidden");
    lastWorkoutDaysEl.textContent = "Brak danych";
    lastWorkoutDateEl.textContent = "Dodaj pierwszy trening";
    statusBadgeEl.textContent = "Brak aktywności";
    return;
  }

  statusEmptyEl.classList.add("hidden");

  const latestWorkout = workouts[0];
  const daysAgo = getDaysAgo(latestWorkout.date);
  lastWorkoutDaysEl.textContent = `Ostatni trening: ${daysAgo} dni temu`;
  lastWorkoutDateEl.textContent = formatDate(latestWorkout.date);

  if (thisWeekCount >= weeklyGoal) {
    statusBadgeEl.textContent = "Cel tygodnia zrealizowany";
  } else {
    statusBadgeEl.textContent = `${weeklyGoal - thisWeekCount} do celu`;
  }
}

function getWeeklyGoal(userProfile) {
  const weeklyGoal = Number(userProfile?.weeklyGoal);
  if (Number.isFinite(weeklyGoal) && weeklyGoal > 0) {
    return weeklyGoal;
  }

  return 3;
}

function getDisplayName(user, userProfile) {
  if (userProfile?.name) {
    return userProfile.name;
  }

  if (user?.email) {
    return user.email.split("@")[0];
  }

  return "Sportowcu";
}

function calculateWeeklyStreak(workouts, weeklyGoal) {
  if (!workouts.length) {
    return 0;
  }

  const weeklyCounts = new Map();
  workouts.forEach((workout) => {
    const weekKey = getISOWeekKey(new Date(workout.date));
    weeklyCounts.set(weekKey, (weeklyCounts.get(weekKey) || 0) + 1);
  });

  let streak = 0;
  let cursor = startOfISOWeek(new Date());

  while (true) {
    const key = getISOWeekKey(cursor);
    const count = weeklyCounts.get(key) || 0;

    if (count >= weeklyGoal) {
      streak += 1;
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() - 7);
      continue;
    }

    break;
  }

  return streak;
}

function startOfISOWeek(date) {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - day + 1);
  return result;
}

function getISOWeekKey(date) {
  const workingDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = workingDate.getUTCDay() || 7;
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(workingDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((workingDate - yearStart) / 86400000) + 1) / 7);
  return `${workingDate.getUTCFullYear()}-${String(weekNumber).padStart(2, "0")}`;
}

function getDaysAgo(dateString) {
  const workoutDate = new Date(dateString);
  workoutDate.setHours(0, 0, 0, 0);

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const diffMs = now.getTime() - workoutDate.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

async function initDashboardPage(user) {
  toggleLoading(true);
  hideMessages();

  const workouts = await getUserWorkoutsSafe(user.uid);
  const userProfile = await getUserProfileSafe(user.uid);
  const workoutIds = workouts.map((workout) => workout.id);
  const exercisesByWorkout = await getExercisesByWorkoutIds(workoutIds);

  let globalPointsEntry = null;
  let allExercisesByWorkout = {};
  const allWorkoutsResult = await getAllWorkoutsSafe();
  const allExercisesResult = await getAllExercisesSafe();
  const hasGlobalPointsAccess = allWorkoutsResult.hasPermission && allExercisesResult.hasPermission;

  if (hasGlobalPointsAccess) {
    allExercisesByWorkout = indexExercisesByWorkout(allExercisesResult.exercises);
    globalPointsEntry = calculatePointsByUser(allWorkoutsResult.workouts, allExercisesByWorkout, null).get(user.uid) || null;
  }

  const renderDashboardByRange = (rangeDays) => {
    const scopedWorkouts = filterWorkoutsByRange(workouts, rangeDays);
    const scopedWorkoutIds = scopedWorkouts.map((workout) => workout.id);
    const scopedExercisesByWorkout = pickExercisesByWorkoutIds(exercisesByWorkout, scopedWorkoutIds);

    let scopedGlobalPointsEntry = globalPointsEntry;
    if (hasGlobalPointsAccess) {
      const scopedGlobalWorkouts = filterWorkoutsByRange(allWorkoutsResult.workouts, rangeDays);
      scopedGlobalPointsEntry = calculatePointsByUser(scopedGlobalWorkouts, allExercisesByWorkout, null).get(user.uid) || null;
    }

    renderDashboardStats(scopedWorkouts, scopedExercisesByWorkout, rangeDays, userProfile);
    renderDashboardPoints(scopedWorkouts, scopedExercisesByWorkout, scopedGlobalPointsEntry);
    // Render progress comparison for latest workout
    renderExerciseProgressComparison(scopedWorkouts, scopedExercisesByWorkout);
  };

  dashboardStrengthRange = globalDataRangeDays;
  renderDashboardByRange(globalDataRangeDays);

  toggleLoading(false);
}

function createSetRow({ setNumber, weight = "", reps = "" }) {
  const setRow = document.createElement("div");
  const comboValue = formatSetComboValue(weight, reps);
  setRow.className = "exercise-set-row";
  setRow.innerHTML = `
    <span class="set-index">${setNumber}</span>
    <div class="set-input-pair">
      <input type="text" inputmode="decimal" class="set-combo" placeholder="15,5 x 8" value="${comboValue}" />
    </div>
    <button type="button" class="set-remove-btn" aria-label="Usuń serię">…</button>
  `;

  const comboInput = setRow.querySelector(".set-combo");
  if (comboInput) {
    comboInput.addEventListener("keydown", (event) => {
      if (event.key !== " ") {
        return;
      }

      const value = comboInput.value;
      if (/x|×/i.test(value)) {
        return;
      }

      event.preventDefault();
      const start = comboInput.selectionStart ?? value.length;
      const end = comboInput.selectionEnd ?? value.length;
      comboInput.setRangeText(" x ", start, end, "end");
    });

    comboInput.addEventListener("blur", () => {
      comboInput.value = comboInput.value.replace(/×/g, "x").replace(/\s+/g, " ").trim();
    });
  }

  return setRow;
}

function renumberSetRows(exerciseCard) {
  const rows = [...exerciseCard.querySelectorAll(".exercise-set-row")];
  rows.forEach((row, index) => {
    const setIndex = row.querySelector(".set-index");
    if (setIndex) {
      setIndex.textContent = String(index + 1);
    }
  });
}

function setupExerciseDragAndDrop(container) {
  let dragSrc = null;
  let dragReadyCard = null;
  let touchDragSrc = null;
  let touchPlaceholder = null;
  let touchClone = null;

  container.addEventListener("mousedown", (event) => {
    const handle = event.target.closest(".drag-handle");
    dragReadyCard = handle ? handle.closest(".exercise-log-card") : null;
  });

  container.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".exercise-log-card");
    if (!card || card !== dragReadyCard) {
      event.preventDefault();
      return;
    }

    dragSrc = card;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", "move");
  });

  container.addEventListener("dragend", (event) => {
    const card = event.target.closest(".exercise-log-card");
    if (card) card.classList.remove("dragging");
    container.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    dragSrc = null;
    dragReadyCard = null;
  });

  container.addEventListener("dragover", (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target.closest(".exercise-log-card");
    if (!target || target === dragSrc) return;
    container.querySelectorAll(".drag-over").forEach((el) => el.classList.remove("drag-over"));
    target.classList.add("drag-over");
  });

  container.addEventListener("dragleave", (event) => {
    const target = event.target.closest(".exercise-log-card");
    if (target) target.classList.remove("drag-over");
  });

  container.addEventListener("drop", (event) => {
    event.preventDefault();
    const target = event.target.closest(".exercise-log-card");
    if (!target || !dragSrc || target === dragSrc) return;
    target.classList.remove("drag-over");
    const cards = [...container.children];
    const srcIdx = cards.indexOf(dragSrc);
    const tgtIdx = cards.indexOf(target);
    if (srcIdx < tgtIdx) {
      container.insertBefore(dragSrc, target.nextSibling);
    } else {
      container.insertBefore(dragSrc, target);
    }
  });

  // Touch support
  container.addEventListener("touchstart", (event) => {
    const handle = event.target.closest(".drag-handle");
    if (!handle) return;
    touchDragSrc = handle.closest(".exercise-log-card");
    if (!touchDragSrc) return;
    touchDragSrc.classList.add("dragging");

    touchClone = touchDragSrc.cloneNode(true);
    touchClone.style.cssText = `position:fixed;z-index:9999;pointer-events:none;width:${touchDragSrc.offsetWidth}px;opacity:0.88;`;
    document.body.appendChild(touchClone);

    touchPlaceholder = document.createElement("div");
    touchPlaceholder.className = "drag-placeholder";
    touchPlaceholder.style.cssText = `height:${touchDragSrc.offsetHeight}px;border-radius:14px;background:rgba(36,108,209,0.07);border:2px dashed rgba(36,108,209,0.3);`;
    touchDragSrc.insertAdjacentElement("afterend", touchPlaceholder);
    touchDragSrc.style.display = "none";

    const touch = event.touches[0];
    touchClone.style.left = `${touch.clientX - touchDragSrc.offsetWidth / 2}px`;
    touchClone.style.top = `${touch.clientY - 20}px`;
  }, { passive: true });

  container.addEventListener("touchmove", (event) => {
    if (!touchDragSrc || !touchClone) return;
    event.preventDefault();
    const touch = event.touches[0];
    touchClone.style.left = `${touch.clientX - touchClone.offsetWidth / 2}px`;
    touchClone.style.top = `${touch.clientY - 20}px`;

    touchPlaceholder && touchPlaceholder.remove();
    touchDragSrc.style.display = "";
    const below = document.elementFromPoint(touch.clientX, touch.clientY);
    touchDragSrc.style.display = "none";
    const targetCard = below && below.closest(".exercise-log-card");
    if (targetCard && targetCard !== touchDragSrc && container.contains(targetCard)) {
      touchPlaceholder = document.createElement("div");
      touchPlaceholder.className = "drag-placeholder";
      touchPlaceholder.style.cssText = `height:${touchDragSrc.offsetHeight}px;border-radius:14px;background:rgba(36,108,209,0.07);border:2px dashed rgba(36,108,209,0.3);`;
      const cards = [...container.children];
      const tgtIdx = cards.indexOf(targetCard);
      const srcIdx = cards.indexOf(touchDragSrc);
      if (srcIdx < tgtIdx) {
        targetCard.insertAdjacentElement("afterend", touchPlaceholder);
      } else {
        targetCard.insertAdjacentElement("beforebegin", touchPlaceholder);
      }
    }
  }, { passive: false });

  container.addEventListener("touchend", () => {
    if (!touchDragSrc) return;
    touchDragSrc.style.display = "";
    touchDragSrc.classList.remove("dragging");
    if (touchPlaceholder) {
      touchPlaceholder.insertAdjacentElement("beforebegin", touchDragSrc);
      touchPlaceholder.remove();
    }
    touchClone && touchClone.remove();
    touchDragSrc = null;
    touchClone = null;
    touchPlaceholder = null;
  });
}

async function initAddWorkoutPage(user) {
  const workoutForm = document.getElementById("workoutForm");
  const exercisesContainer = document.getElementById("exercisesContainer");
  const addExerciseBtn = document.getElementById("addExerciseBtn");
  const dateInput = document.getElementById("workoutDate");
  const workoutNameInput = document.getElementById("workoutName");
  const workoutNameList = document.getElementById("workoutNameList");
  const templateSelect = document.getElementById("workoutTemplate");
  const templateHint = document.getElementById("templateHint");
  const templateBuilderForm = document.getElementById("templateBuilderForm");
  const templateExercisesContainer = document.getElementById("templateExercisesContainer");
  const addTemplateExerciseBtn = document.getElementById("addTemplateExerciseBtn");
  const savedTemplatesList = document.getElementById("savedTemplatesList");
  const templateBuilderState = document.getElementById("templateBuilderState");
  const cancelTemplateEditBtn = document.getElementById("cancelTemplateEditBtn");
  const saveTemplateBtn = document.getElementById("saveTemplateBtn");
  const templateBuilderToggleBtn = document.getElementById("templateBuilderToggleBtn");
  const templateBuilderContent = document.getElementById("templateBuilderContent");

  const setTemplateBuilderExpanded = (expanded) => {
    if (!templateBuilderToggleBtn || !templateBuilderContent) {
      return;
    }

    templateBuilderContent.classList.toggle("hidden", !expanded);
    templateBuilderToggleBtn.setAttribute("aria-expanded", String(expanded));
    templateBuilderToggleBtn.textContent = expanded ? "Zwiń" : "Rozwiń";
  };

  if (templateBuilderToggleBtn && templateBuilderContent) {
    templateBuilderToggleBtn.addEventListener("click", () => {
      const expanded = templateBuilderToggleBtn.getAttribute("aria-expanded") === "true";
      setTemplateBuilderExpanded(!expanded);
    });
    setTemplateBuilderExpanded(false);
  }

  dateInput.value = formatDateForInput(new Date());

  const allUserWorkouts = await getUserWorkoutsSafe(user.uid);
  const userWorkoutsCache = filterWorkoutsByRange(allUserWorkouts, globalDataRangeDays);
  addWorkoutTemplatesCache = await getUserTemplates(user.uid);

  const refreshWorkoutNames = () => {
    if (!workoutNameList) {
      return;
    }

    const options = new Set();

    userWorkoutsCache.forEach((workout) => {
      const title = String(workout?.title || "").trim();
      if (title) {
        options.add(title);
      }
    });

    addWorkoutTemplatesCache.forEach((template) => {
      const templateName = String(template?.name || "").trim();
      if (templateName) {
        options.add(templateName);
      }
    });

    const sorted = [...options].sort((a, b) => a.localeCompare(b, "pl", { sensitivity: "base" }));
    workoutNameList.innerHTML = sorted
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("");
  };

  const refreshTemplateSelect = () => {
    if (!templateSelect) {
      return;
    }

    templateSelect.innerHTML = `
      <option value="">-- Brak szablonu (pusta lista) --</option>
      ${addWorkoutTemplatesCache
        .map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`)
        .join("")}
    `;
  };

  const renderSavedTemplates = () => {
    if (!savedTemplatesList) {
      return;
    }

    if (!addWorkoutTemplatesCache.length) {
      savedTemplatesList.innerHTML = "<li>Brak własnych szablonow.</li>";
      return;
    }

    savedTemplatesList.innerHTML = addWorkoutTemplatesCache
      .map(
        (template) => `
          <li class="template-list-item">
            <strong>${escapeHtml(template.name)}</strong><br />
            <span class="text-muted">${template.exercises
              .map((exercise) => `${escapeHtml(exercise.name)} (${exercise.defaultWeight} kg)`)
              .join(" | ")}</span>
            <div class="history-actions">
              <button class="history-action-btn" data-template-action="edit" data-id="${template.id}" type="button">Edytuj</button>
              <button class="history-action-btn history-action-btn-danger" data-template-action="delete" data-id="${template.id}" type="button">Usuń</button>
            </div>
          </li>
        `
      )
      .join("");

    savedTemplatesList.onclick = async (event) => {
      const button = event.target.closest("button[data-template-action][data-id]");
      if (!button) {
        return;
      }

      const action = button.dataset.templateAction;
      const templateId = button.dataset.id;

      try {
        if (action === "edit") {
          setTemplateBuilderExpanded(true);
          openTemplateEditor(templateId, templateExercisesContainer, templateBuilderForm, templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
        }

        if (action === "delete") {
          const deleted = await deleteTemplate(user.uid, templateId);
          if (!deleted) {
            return;
          }

          addWorkoutTemplatesCache = await getUserTemplates(user.uid);
          refreshTemplateSelect();
          renderSavedTemplates();

          if (editingTemplateId === templateId) {
            if (templateBuilderForm) {
              templateBuilderForm.reset();
            }

            if (templateExercisesContainer) {
              templateExercisesContainer.innerHTML = "";
              addTemplateExerciseRow();
            }

            resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
          }

          if (templateSelect && templateSelect.value === templateId) {
            templateSelect.value = "";
            applyTemplate();
          }
          showSuccess("Szablon został usunięty.");
        }
      } catch (error) {
        showError(getFriendlyError(error));
      }
    };
  };

  // createSetRow and renumberSetRows are defined at module level

  const addExerciseRow = (config = {}) => {
    const {
      name = "",
      defaultWeight = 0,
      sets = 4,
      reps = 8,
      isCustom = false,
    } = config;

    const wrapper = document.createElement("div");
    wrapper.className = "exercise-item exercise-log-card";
    wrapper.draggable = true;

    const safeName = escapeHtml(name);
    const parsedWeight = Number.isFinite(Number(defaultWeight)) ? Number(defaultWeight) : 0;
    const defaultSets = Math.max(1, Number(sets) || 1);
    const defaultReps = Math.max(1, Number(reps) || 8);

    wrapper.innerHTML = `
      <div class="exercise-log-head">
        <span class="drag-handle" aria-label="Przeciągnij aby zmienić kolejność">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="5" r="1.4"/><circle cx="15" cy="5" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="19" r="1.4"/><circle cx="15" cy="19" r="1.4"/></svg>
        </span>
        <input
          type="text"
          name="exerciseName"
          class="exercise-name-input"
          value="${safeName}"
          placeholder="Np. Bench Press"
          ${isCustom ? "" : "readonly"}
          required
        />
        <button type="button" class="remove-exercise-icon" aria-label="Usuń ćwiczenie">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"></path>
          </svg>
        </button>
      </div>
      <div class="exercise-set-table" role="table" aria-label="Serie ćwiczenia">
        <div class="exercise-set-head" role="row">
          <span>Set</span>
          <span>KG x Powt.</span>
          <span></span>
        </div>
        <div class="exercise-set-rows"></div>
      </div>
      <div class="exercise-log-footer">
        <button type="button" class="btn btn-ghost add-set-btn">+ Set</button>
      </div>
    `;

    const rowsContainer = wrapper.querySelector(".exercise-set-rows");
    for (let setIndex = 1; setIndex <= defaultSets; setIndex += 1) {
      rowsContainer.appendChild(
        createSetRow({
          setNumber: setIndex,
          weight: parsedWeight > 0 ? parsedWeight : "",
          reps: defaultReps,
        })
      );
    }

    wrapper.addEventListener("click", (event) => {
      const target = event.target;

      if (target.closest(".add-set-btn")) {
        const lastRow = rowsContainer.querySelector(".exercise-set-row:last-child");
        const nextSetNumber = rowsContainer.querySelectorAll(".exercise-set-row").length + 1;
        const lastCombo = lastRow?.querySelector(".set-combo")?.value || "";
        const parsedLastSet = parseSetComboValue(lastCombo);

        rowsContainer.appendChild(
          createSetRow({
            setNumber: nextSetNumber,
            weight: parsedLastSet.weight,
            reps: parsedLastSet.reps,
          })
        );
        return;
      }

      if (target.closest(".set-remove-btn")) {
        const row = target.closest(".exercise-set-row");
        row.remove();

        if (!rowsContainer.querySelector(".exercise-set-row")) {
          rowsContainer.appendChild(
            createSetRow({
              setNumber: 1,
              weight: parsedWeight > 0 ? parsedWeight : "",
              reps: defaultReps,
            })
          );
        }

        renumberSetRows(wrapper);
      }
    });

    const removeBtn = wrapper.querySelector(".remove-exercise-icon");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        wrapper.remove();
        if (!exercisesContainer.children.length && templateHint) {
          templateHint.textContent = "Lista ćwiczeń jest pusta. Wybierz szablon lub dodaj własne ćwiczenie.";
        }
      });
    }

    exercisesContainer.appendChild(wrapper);
  };

  setupExerciseDragAndDrop(exercisesContainer);

  const applyTemplate = () => {
    if (!templateSelect) {
      return;
    }

    const templateId = templateSelect.value;
    exercisesContainer.innerHTML = "";

    const template = addWorkoutTemplatesCache.find((item) => item.id === templateId);

    if (!templateId || !template) {
      if (templateHint) {
        templateHint.textContent = "Brak wybranego szablonu - lista ćwiczeń jest pusta.";
      }
      return;
    }

    if (templateHint) {
      templateHint.textContent = `Załadowano szablon: ${template.name}.`;
    }

    if (workoutNameInput && !workoutNameInput.value.trim()) {
      workoutNameInput.value = template.name;
    }

    template.exercises.forEach((exercise) => addExerciseRow({ ...exercise, sets: 1, isCustom: false }));
  };

  const addTemplateExerciseRow = (data = {}) => {
    if (!templateExercisesContainer) {
      return;
    }

    const hasDefaultWeight = Number.isFinite(Number(data.defaultWeight));
    const templateWeightValue = hasDefaultWeight ? String(Number(data.defaultWeight)) : "";

    const row = document.createElement("div");
    row.className = "exercise-item";
    row.innerHTML = `
      <div class="exercise-header">
        <strong>Ćwiczenie szablonu</strong>
        <button type="button" class="link-btn remove-template-exercise">Usuń</button>
      </div>
      <div class="grid grid-2">
        <div class="form-row">
          <label>Nazwa ćwiczenia</label>
          <input type="text" class="template-exercise-name" value="${escapeHtml(data.name || "")}" placeholder="Np. Wyciskanie skos" required />
        </div>
        <div class="form-row">
          <label>Domyslny ciezar (kg)</label>
          <input type="text" inputmode="decimal" class="template-exercise-weight" value="${templateWeightValue}" placeholder="0" required />
        </div>
      </div>
    `;

    row.querySelector(".remove-template-exercise").onclick = () => {
      row.remove();
      if (!templateExercisesContainer.children.length) {
        addTemplateExerciseRow();
      }
    };

    templateExercisesContainer.appendChild(row);
  };

  const collectTemplateExercises = () => {
    const rows = [...document.querySelectorAll("#templateExercisesContainer .exercise-item")];
    const exercises = rows.map((row) => ({
      name: row.querySelector(".template-exercise-name").value.trim(),
      defaultWeight: parseDecimalInput(row.querySelector(".template-exercise-weight").value),
    }));

    const hasInvalid = exercises.some(
      (exercise) => !exercise.name || Number.isNaN(exercise.defaultWeight)
    );

    if (hasInvalid) {
      throw new Error("Uzupełnij poprawnie wszystkie pola szablonu.");
    }

    return exercises;
  };

  if (templateSelect) {
    templateSelect.addEventListener("change", applyTemplate);
  }

  if (addTemplateExerciseBtn) {
    addTemplateExerciseBtn.addEventListener("click", () => addTemplateExerciseRow());
  }

  addExerciseBtn.addEventListener("click", () => {
    addExerciseRow({ isCustom: true, sets: 1, reps: 8, defaultWeight: 0 });
    if (templateHint) {
      templateHint.textContent = "Dodano własne ćwiczenie.";
    }
  });

  if (templateBuilderForm) {
    templateBuilderForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      hideMessages();

      try {
        const templateNameInput = document.getElementById("templateName");
        const templateName = templateNameInput.value.trim();
        const exercises = collectTemplateExercises();

        if (!templateName) {
          throw new Error("Podaj nazwe szablonu.");
        }

        const payload = {
          name: templateName,
          exercises,
          userId: user.uid,
          updatedAt: serverTimestamp(),
        };

        const isEditingTemplate = Boolean(editingTemplateId);

        if (isEditingTemplate) {
          await updateDoc(doc(db, "templates", editingTemplateId), payload);
        } else {
          await addDoc(collection(db, "templates"), {
            ...payload,
            createdAt: serverTimestamp(),
          });
        }

        addWorkoutTemplatesCache = await getUserTemplates(user.uid);
        refreshTemplateSelect();
        refreshWorkoutNames();
        renderSavedTemplates();

        templateBuilderForm.reset();
        templateExercisesContainer.innerHTML = "";
        addTemplateExerciseRow();
        resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
        showSuccess(isEditingTemplate ? "Szablon został zaktualizowany." : "Szablon został zapisany.");
      } catch (error) {
        showError(getFriendlyError(error));
      }
    });
  }

  if (cancelTemplateEditBtn) {
    cancelTemplateEditBtn.onclick = () => {
      if (templateBuilderForm) {
        templateBuilderForm.reset();
      }
      if (templateExercisesContainer) {
        templateExercisesContainer.innerHTML = "";
        addTemplateExerciseRow();
      }
      resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
    };
  }

  refreshTemplateSelect();
  refreshWorkoutNames();
  renderSavedTemplates();
  if (templateExercisesContainer) {
    addTemplateExerciseRow();
  }
  resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
  applyTemplate();

  workoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideMessages();
    toggleLoading(true);

    try {
      const workoutDate = workoutForm.workoutDate.value;
      const workoutName = workoutForm.workoutName.value.trim();
      const selectedTemplate = addWorkoutTemplatesCache.find((template) => template.id === templateSelect?.value);
      const workoutTitle = workoutName || selectedTemplate?.name || "Trening";
      const exerciseItems = [...exercisesContainer.querySelectorAll(".exercise-log-card")];

      if (!workoutDate) {
        throw new Error("Wybierz date treningu.");
      }

      if (!workoutTitle) {
        throw new Error("Podaj nazwę treningu.");
      }

      if (!exerciseItems.length) {
        throw new Error("Dodaj przynajmniej jedno ćwiczenie.");
      }

      const exercises = exerciseItems.map((item) => {
        const name = item.querySelector("input[name='exerciseName']")?.value.trim() || "";
        const setRows = [...item.querySelectorAll(".exercise-set-row")];

        const setDetails = setRows.map((row) => {
          const setText = row.querySelector(".set-combo")?.value;
          const { weight, reps } = parseSetComboValue(setText);

          return {
            weight,
            reps,
            completed: false,
          };
        });

        const validSets = setDetails.filter(
          (setData) => Number.isFinite(setData.weight) && Number.isFinite(setData.reps) && setData.reps > 0
        );

        const sets = validSets.length;
        const reps =
          sets > 0
            ? Math.round(validSets.reduce((sum, setData) => sum + setData.reps, 0) / sets)
            : NaN;
        const weight =
          sets > 0
            ? validSets.reduce((max, setData) => Math.max(max, setData.weight), 0)
            : NaN;

        return {
          name,
          sets,
          reps,
          weight,
          setDetails,
        };
      });

      const hasInvalidExercise = exercises.some(
        (exercise) =>
          !exercise.name ||
          Number.isNaN(exercise.sets) ||
          Number.isNaN(exercise.reps) ||
          Number.isNaN(exercise.weight)
      );

      if (hasInvalidExercise) {
        throw new Error("Uzupełnij poprawnie wszystkie pola ćwiczeń.");
      }

      // Najpierw zapis treningu, potem ćwiczeń z workoutId.
      const workoutRef = await addDoc(collection(db, "workouts"), {
        userId: user.uid,
        title: workoutTitle,
        date: workoutDate,
        createdAt: serverTimestamp(),
      });


      // Save exercises and exercise names
      await Promise.all(
        exercises.map(async (exercise) => {
          await addDoc(collection(db, "exercises"), {
            workoutId: workoutRef.id,
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            weight: exercise.weight,
            setDetails: exercise.setDetails,
          });

          // Save exercise name to 'exerciseNames' collection (capitalized, unique per user)
          const normalizedName = normalizeExerciseName(exercise.name);
          // Capitalize: first letter uppercase, rest lowercase for each word
          function capitalizeWords(str) {
            return String(str)
              .toLowerCase()
              .replace(/\b\w/g, (char) => char.toUpperCase());
          }
          const capitalizedName = capitalizeWords(exercise.name);
          if (normalizedName) {
            const exerciseNameDoc = doc(db, "exerciseNames", `${user.uid}_${normalizedName}`);
            // Check if already exists
            const existing = await getDoc(exerciseNameDoc);
            if (!existing.exists()) {
              await setDoc(exerciseNameDoc, {
                userId: user.uid,
                name: capitalizedName,
                normalizedName,
                updatedAt: serverTimestamp(),
              }, { merge: true });
            }
          }
        })
      );

      showSuccess("Trening został zapisany.");
      workoutForm.reset();
      dateInput.value = formatDateForInput(new Date());
      if (workoutNameInput) {
        workoutNameInput.value = "";
      }
      if (templateSelect) {
        templateSelect.value = "";
      }
      exercisesContainer.innerHTML = "";
      if (templateHint) {
        templateHint.textContent = "Brak wybranego szablonu - lista ćwiczeń jest pusta.";
      }
    } catch (error) {
      showError(getFriendlyError(error));
      console.error(error);
    } finally {
      toggleLoading(false);
    }
  });
}

function openTemplateEditor(templateId, templateExercisesContainer, templateBuilderForm, templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn) {
  const template = addWorkoutTemplatesCache.find((item) => item.id === templateId);
  if (!template || !templateBuilderForm || !templateExercisesContainer) {
    return;
  }

  editingTemplateId = templateId;
  templateBuilderForm.templateName.value = template.name;
  templateExercisesContainer.innerHTML = "";
  template.exercises.forEach((exercise) => addTemplateExerciseRowForEditor(templateExercisesContainer, exercise));

  if (templateBuilderState) {
    templateBuilderState.textContent = `Edytujesz szablon: ${template.name}`;
  }

  if (cancelTemplateEditBtn) {
    cancelTemplateEditBtn.classList.remove("hidden");
  }

  if (saveTemplateBtn) {
    saveTemplateBtn.textContent = "Zapisz zmiany";
  }
}

function addTemplateExerciseRowForEditor(container, data = {}) {
  const hasDefaultWeight = Number.isFinite(Number(data.defaultWeight));
  const templateWeightValue = hasDefaultWeight ? String(Number(data.defaultWeight)) : "";

  const row = document.createElement("div");
  row.className = "exercise-item";
  row.innerHTML = `
    <div class="exercise-header">
      <strong>Ćwiczenie szablonu</strong>
      <button type="button" class="link-btn remove-template-exercise">Usuń</button>
    </div>
    <div class="grid grid-2">
      <div class="form-row">
        <label>Nazwa ćwiczenia</label>
        <input type="text" class="template-exercise-name" value="${escapeHtml(data.name || "")}" placeholder="Np. Wyciskanie skos" required />
      </div>
      <div class="form-row">
        <label>Domyslny ciezar (kg)</label>
        <input type="text" inputmode="decimal" class="template-exercise-weight" value="${templateWeightValue}" placeholder="0" required />
      </div>
    </div>
  `;

  row.querySelector(".remove-template-exercise").onclick = () => {
    row.remove();
    if (!container.children.length) {
      addTemplateExerciseRowForEditor(container);
    }
  };

  container.appendChild(row);
}

function resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn) {
  editingTemplateId = null;

  if (templateBuilderState) {
    templateBuilderState.textContent = "Tworzysz nowy szablon.";
  }

  if (cancelTemplateEditBtn) {
    cancelTemplateEditBtn.classList.add("hidden");
  }

  if (saveTemplateBtn) {
    saveTemplateBtn.textContent = "Zapisz szablon";
  }
}

async function getUserTemplates(userId) {
  const snapshot = await getDocs(query(collection(db, "templates"), where("userId", "==", userId)));
  return snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((first, second) => first.name.localeCompare(second.name, "pl", { sensitivity: "base" }));
}

async function deleteTemplate(userId, templateId) {
  const templateRef = doc(db, "templates", templateId);
  const templateSnap = await getDoc(templateRef);
  if (!templateSnap.exists()) {
    return false;
  }

  const data = templateSnap.data();
  if (data.userId !== userId) {
    throw new Error("Nie możesz usunąć cudzego szablonu.");
  }

  const shouldDelete = window.confirm("Czy na pewno chcesz usunąć ten szablon?");
  if (!shouldDelete) {
    return false;
  }

  await deleteDoc(templateRef);
  return true;
}

async function initProfilePage(user) {
  toggleLoading(true);
  hideMessages();

  const profileData = (await getUserProfileSafe(user.uid)) || {};

  const profileName = document.getElementById("profileName");
  const profileBirthDate = document.getElementById("profileBirthDate");
  const profileWeeklyGoal = document.getElementById("profileWeeklyGoal");
  const profileEmail = document.getElementById("profileEmail");
  const profileCreated = document.getElementById("profileCreated");
  const profilePhoto = document.getElementById("profilePhoto");
  const profileAvatarFallback = document.getElementById("profileAvatarFallback");
  const profileDisplayName = document.getElementById("profileDisplayName");
  const profileDisplayEmail = document.getElementById("profileDisplayEmail");
  const profileDisplayWeeklyGoal = document.getElementById("profileDisplayWeeklyGoal");

  const nameValue = profileData.name || "-";
  const emailValue = profileData.email || user.email || "-";
  const createdValue = formatTimestamp(profileData.createdAt) || "-";
  const weeklyGoalValue = getWeeklyGoal(profileData);
  const birthDateValue = profileData.birthDate
    ? formatDate(profileData.birthDate)
    : Number.isFinite(Number(profileData.birthYear))
      ? String(profileData.birthYear)
      : "-";
  const photoUrl = typeof profileData.photoURL === "string" ? profileData.photoURL : "";

  profileName.textContent = nameValue;
  profileBirthDate.textContent = birthDateValue;
  profileWeeklyGoal.textContent = `${formatTrainingCount(weeklyGoalValue)} tygodniowo`;
  profileEmail.textContent = emailValue;
  profileCreated.textContent = createdValue;
  profileDisplayName.textContent = nameValue;
  profileDisplayEmail.textContent = emailValue;
  profileDisplayWeeklyGoal.textContent = `Cel: ${formatTrainingCount(weeklyGoalValue)} tygodniowo`;
  profileAvatarFallback.textContent = getInitial(nameValue || emailValue);

  if (photoUrl) {
    profilePhoto.src = photoUrl;
    profilePhoto.classList.remove("hidden");
    profileAvatarFallback.classList.add("hidden");
  } else {
    profilePhoto.removeAttribute("src");
    profilePhoto.classList.add("hidden");
    profileAvatarFallback.classList.remove("hidden");
  }

  toggleLoading(false);
}

async function initProfileEditPage(user) {
  toggleLoading(true);
  hideMessages();

  const userRef = doc(db, "users", user.uid);
  let profileData = (await getUserProfileSafe(user.uid)) || {};

  const currentNameEl = document.getElementById("currentProfileName");
  const currentBirthDateEl = document.getElementById("currentProfileBirthDate");
  const currentPhotoEl = document.getElementById("currentProfilePhoto");
  const currentFallbackEl = document.getElementById("currentProfileFallback");

  const form = document.getElementById("profileEditForm");
  const nameInput = document.getElementById("editProfileName");
  const birthDateInput = document.getElementById("editProfileBirthDate");
  const weeklyGoalInput = document.getElementById("editProfileWeeklyGoal");
  const photoInput = document.getElementById("editProfilePhoto");
  const photoPreview = document.getElementById("editProfilePhotoPreview");
  const removePhotoBtn = document.getElementById("removeProfilePhotoBtn");

  let selectedPhotoFile = null;

  const clearPreview = () => {
    selectedPhotoFile = null;
    if (photoInput) {
      photoInput.value = "";
    }
    if (photoPreview) {
      photoPreview.classList.add("hidden");
      photoPreview.removeAttribute("src");
    }
  };

  const renderCurrent = () => {
    const name = profileData.name || "-";
    const birthDate = profileData.birthDate
      ? formatDate(profileData.birthDate)
      : Number.isFinite(Number(profileData.birthYear))
        ? String(profileData.birthYear)
        : "-";
    const photoURL = profileData.photoURL || "";

    currentNameEl.textContent = name;
    currentBirthDateEl.textContent = birthDate;
    currentFallbackEl.textContent = getInitial(name || user.email || "P");

    if (photoURL) {
      currentPhotoEl.src = photoURL;
      currentPhotoEl.classList.remove("hidden");
      currentFallbackEl.classList.add("hidden");
    } else {
      currentPhotoEl.removeAttribute("src");
      currentPhotoEl.classList.add("hidden");
      currentFallbackEl.classList.remove("hidden");
    }

    nameInput.value = profileData.name || "";
    birthDateInput.value = profileData.birthDate || "";
    weeklyGoalInput.value = String(getWeeklyGoal(profileData));
  };

  photoInput.onchange = () => {
    const file = photoInput.files?.[0];
    if (!file) {
      clearPreview();
      return;
    }

    if (!file.type.startsWith("image/")) {
      showError("Wybierz plik graficzny (JPG/PNG/WebP).", "pageError");
      clearPreview();
      return;
    }

    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      showError("Zdjęcie jest za duze. Maksymalny rozmiar to 4 MB.", "pageError");
      clearPreview();
      return;
    }

    selectedPhotoFile = file;
    const previewUrl = URL.createObjectURL(file);
    photoPreview.src = previewUrl;
    photoPreview.classList.remove("hidden");
  };

  removePhotoBtn.onclick = async () => {
    hideMessages();
    toggleLoading(true);

    try {
      if (profileData.photoPath) {
        try {
          await deleteObject(ref(storage, profileData.photoPath));
        } catch (error) {
          if (!String(error?.code || "").includes("storage/object-not-found")) {
            throw error;
          }
        }
      }

      await setDoc(userRef, {
        photoURL: "",
        photoPath: "",
        updatedAt: serverTimestamp(),
      }, { merge: true });

      profileData.photoURL = "";
      profileData.photoPath = "";
      clearPreview();
      renderCurrent();
      showSuccess("Zdjęcie profilowe zostało usunięte.");
    } catch (error) {
      showError(getFriendlyError(error));
    } finally {
      toggleLoading(false);
    }
  };

  form.onsubmit = async (event) => {
    event.preventDefault();
    hideMessages();
    toggleLoading(true);

    try {
      const name = nameInput.value.trim();
      const birthDate = birthDateInput.value;
      const weeklyGoal = Number(weeklyGoalInput.value);

      if (!name) {
        throw new Error("Imię jest wymagane.");
      }

      if (!Number.isInteger(weeklyGoal) || weeklyGoal < 1 || weeklyGoal > 14) {
        throw new Error("Cel tygodniowy musi być liczbą od 1 do 14.");
      }

      let birthYear = null;
      if (birthDate) {
        birthYear = Number(birthDate.slice(0, 4));
      }

      const payload = {
        name,
        birthDate: birthDate || "",
        birthYear,
        weeklyGoal,
        email: profileData.email || user.email || "",
        updatedAt: serverTimestamp(),
      };

      if (!profileData.createdAt) {
        payload.createdAt = serverTimestamp();
      }

      if (selectedPhotoFile) {
        if (profileData.photoPath) {
          try {
            await deleteObject(ref(storage, profileData.photoPath));
          } catch (error) {
            if (!String(error?.code || "").includes("storage/object-not-found")) {
              throw error;
            }
          }
        }

        const safeName = selectedPhotoFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = `profilePhotos/${user.uid}/avatar-${Date.now()}-${safeName}`;
        const photoRef = ref(storage, storagePath);

        await uploadBytes(photoRef, selectedPhotoFile);
        payload.photoURL = await getDownloadURL(photoRef);
        payload.photoPath = storagePath;
      }

      await setDoc(userRef, payload, { merge: true });
      profileData = { ...profileData, ...payload };

      clearPreview();
      renderCurrent();
      showSuccess("Profil został zaktualizowany.");
    } catch (error) {
      showError(getFriendlyError(error));
    } finally {
      toggleLoading(false);
    }
  };

  renderCurrent();
  toggleLoading(false);
}

async function initWorkoutsPage(user) {
  toggleLoading(true);
  hideMessages();

  const allUserWorkouts = await getUserWorkoutsSafe(user.uid);
  workoutsPageCache = filterWorkoutsByRange(allUserWorkouts, globalDataRangeDays);
  const workoutIds = workoutsPageCache.map((workout) => workout.id);
  workoutsExercisesCache = await getExercisesByWorkoutIds(workoutIds);

  renderWorkoutsPageList();
  setupWorkoutsEditor();

  toggleLoading(false);
}

function renderWorkoutsPageList() {
  const list = document.getElementById("workoutsPageList");
  if (!list) {
    return;
  }

  if (!workoutsPageCache.length) {
    list.innerHTML = "<li>Brak treningów. Dodaj pierwszy trening.</li>";
    return;
  }


  list.innerHTML = workoutsPageCache
    .map((workout) => {
      const exercises = workoutsExercisesCache[workout.id] || [];
      const workoutTitle = workout.title || "Trening";
      // Unique exercise names (case-insensitive, capitalized)
      const uniqueNamesMap = new Map();
      exercises.forEach(ex => {
        const cap = String(ex.name || "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
        const norm = cap.trim().toLowerCase();
        if (norm && !uniqueNamesMap.has(norm)) uniqueNamesMap.set(norm, cap);
      });
      const uniqueNames = [...uniqueNamesMap.values()];
      const exercisesSummary = uniqueNames.length ? uniqueNames.join(", ") : "Brak ćwiczeń";

      return `
        <li class="history-entry workouts-page-entry stacked-history-entry">
          <span class="history-date">${formatDate(workout.date)}</span>
          <span class="history-title">${escapeHtml(workoutTitle)}</span>
          <span class="history-exercises stacked-history-exercises">${exercisesSummary}</span>
          <div class="history-actions">
            <button class="history-action-btn" data-workout-action="edit" data-id="${workout.id}" type="button">Edytuj</button>
            <button class="history-action-btn history-action-btn-danger" data-workout-action="delete" data-id="${workout.id}" type="button">Usuń</button>
          </div>
        </li>
      `;
    })
    .join("");

  list.onclick = (event) => {
    const button = event.target.closest("button[data-workout-action][data-id]");
    if (!button) {
      return;
    }

    const action = button.dataset.workoutAction;
    const workoutId = button.dataset.id;

    if (action === "edit") {
      openWorkoutEditor(workoutId);
    }

    if (action === "delete") {
      deleteWorkoutFromWorkoutsPage(workoutId);
    }
  };
}

function setupWorkoutsEditor() {
  const form = document.getElementById("workoutEditForm");
  const addExerciseBtn = document.getElementById("editAddExerciseBtn");
  const cancelBtn = document.getElementById("cancelEditBtn");

  if (!form || !addExerciseBtn || !cancelBtn) {
    return;
  }

  addExerciseBtn.onclick = () => addWorkoutEditorExerciseRow();
  cancelBtn.onclick = () => closeWorkoutEditor();

  form.onsubmit = async (event) => {
    event.preventDefault();

    if (!editingWorkoutId || !auth.currentUser) {
      return;
    }

    hideMessages();
    toggleLoading(true);

    try {
      const title = form.editWorkoutTitle.value.trim();
      const date = form.editWorkoutDate.value.trim();
      const exercises = collectWorkoutEditorExercises();

      if (!title) {
        throw new Error("Podaj nazwę treningu.");
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Niepoprawny format daty. Uzyj YYYY-MM-DD.");
      }

      if (!exercises.length) {
        throw new Error("Dodaj przynajmniej jedno ćwiczenie.");
      }

      await updateDoc(doc(db, "workouts", editingWorkoutId), {
        title,
        date,
      });

      const existingQuery = query(collection(db, "exercises"), where("workoutId", "==", editingWorkoutId));
      const existingSnapshot = await getDocs(existingQuery);
      await Promise.all(
        existingSnapshot.docs.map((exerciseDoc) => deleteDoc(doc(db, "exercises", exerciseDoc.id)))
      );

      await Promise.all(
        exercises.map((exercise) =>
          addDoc(collection(db, "exercises"), {
            workoutId: editingWorkoutId,
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            weight: exercise.weight,
            setDetails: exercise.setDetails,
          })
        )
      );

      showSuccess("Trening został zaktualizowany.");
      closeWorkoutEditor();
      await initWorkoutsPage(auth.currentUser);
    } catch (error) {
      showError(getFriendlyError(error));
      console.error(error);
    } finally {
      toggleLoading(false);
    }
  };
}

function openWorkoutEditor(workoutId) {
  const workout = workoutsPageCache.find((item) => item.id === workoutId);
  const card = document.getElementById("workoutEditorCard");
  const form = document.getElementById("workoutEditForm");
  const exercisesContainer = document.getElementById("editExercisesContainer");

  if (!workout || !card || !form || !exercisesContainer) {
    return;
  }

  editingWorkoutId = workoutId;
  form.editWorkoutTitle.value = workout.title || "Trening";
  form.editWorkoutDate.value = workout.date || "";

  exercisesContainer.innerHTML = "";
  const exercises = workoutsExercisesCache[workoutId] || [];
  if (!exercises.length) {
    addWorkoutEditorExerciseRow();
  } else {
    exercises.forEach((exercise) => addWorkoutEditorExerciseRow(exercise));
  }

  card.classList.remove("hidden");
  card.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeWorkoutEditor() {
  const card = document.getElementById("workoutEditorCard");
  if (card) {
    card.classList.add("hidden");
  }

  editingWorkoutId = null;
}

function addWorkoutEditorExerciseRow(data = {}) {
  const container = document.getElementById("editExercisesContainer");
  if (!container) {
    return;
  }

  const safeName = escapeHtml(data.name || "");
  const defaultWeight = Number.isFinite(parseDecimalInput(data.weight)) ? parseDecimalInput(data.weight) : 0;
  const defaultReps = Math.max(1, Number(data.reps) || 8);

  const wrapper = document.createElement("div");
  wrapper.className = "exercise-item exercise-log-card";
  wrapper.innerHTML = `
    <div class="exercise-log-head">
      <input
        type="text"
        class="exercise-name-input edit-ex-name"
        value="${safeName}"
        placeholder="Np. Bench Press"
        required
      />
      <button type="button" class="remove-exercise-icon workout-editor-remove" aria-label="Usuń ćwiczenie">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"></path>
        </svg>
      </button>
    </div>
    <div class="exercise-set-table" role="table" aria-label="Serie ćwiczenia">
      <div class="exercise-set-head" role="row">
        <span>Set</span>
        <span>KG x Powt.</span>
        <span></span>
      </div>
      <div class="exercise-set-rows"></div>
    </div>
    <div class="exercise-log-footer">
      <button type="button" class="btn btn-ghost add-set-btn">+ Set</button>
    </div>
  `;

  const rowsContainer = wrapper.querySelector(".exercise-set-rows");

  const setDetails = Array.isArray(data.setDetails) && data.setDetails.length
    ? data.setDetails
    : null;

  if (setDetails) {
    setDetails.forEach((setData, idx) => {
      rowsContainer.appendChild(
        createSetRow({
          setNumber: idx + 1,
          weight: Number.isFinite(parseDecimalInput(setData.weight)) ? parseDecimalInput(setData.weight) : "",
          reps: Number(setData.reps) || "",
        })
      );
    });
  } else {
    const setsCount = Math.max(1, Number(data.sets) || 1);
    for (let i = 1; i <= setsCount; i += 1) {
      rowsContainer.appendChild(
        createSetRow({
          setNumber: i,
          weight: defaultWeight > 0 ? defaultWeight : "",
          reps: defaultReps,
        })
      );
    }
  }

  wrapper.addEventListener("click", (event) => {
    const target = event.target;

    if (target.closest(".add-set-btn")) {
      const lastRow = rowsContainer.querySelector(".exercise-set-row:last-child");
      const nextSetNumber = rowsContainer.querySelectorAll(".exercise-set-row").length + 1;
      const lastCombo = lastRow?.querySelector(".set-combo")?.value || "";
      const parsedLastSet = parseSetComboValue(lastCombo);
      rowsContainer.appendChild(createSetRow({ setNumber: nextSetNumber, weight: parsedLastSet.weight, reps: parsedLastSet.reps }));
      return;
    }

    if (target.closest(".set-remove-btn")) {
      const row = target.closest(".exercise-set-row");
      row.remove();
      if (!rowsContainer.querySelector(".exercise-set-row")) {
        rowsContainer.appendChild(createSetRow({ setNumber: 1, weight: defaultWeight > 0 ? defaultWeight : "", reps: defaultReps }));
      }
      renumberSetRows(wrapper);
    }
  });

  wrapper.querySelector(".workout-editor-remove").onclick = () => {
    wrapper.remove();
    if (!container.children.length) {
      addWorkoutEditorExerciseRow();
    }
  };

  container.appendChild(wrapper);
}

function collectWorkoutEditorExercises() {
  const cards = [...document.querySelectorAll("#editExercisesContainer .exercise-item")];
  const exercises = cards.map((card) => {
    const name = card.querySelector(".edit-ex-name")?.value.trim() || "";
    const setRows = [...card.querySelectorAll(".exercise-set-row")];

    const setDetails = setRows.map((row) => ({
      ...parseSetComboValue(row.querySelector(".set-combo")?.value),
      completed: false,
    }));

    const validSets = setDetails.filter(
      (s) => Number.isFinite(s.weight) && Number.isFinite(s.reps) && s.reps > 0
    );

    const sets = validSets.length;
    const reps = sets > 0
      ? Math.round(validSets.reduce((sum, s) => sum + s.reps, 0) / sets)
      : 0;
    const weight = sets > 0
      ? validSets.reduce((max, s) => Math.max(max, s.weight), 0)
      : 0;

    return { name, sets, reps, weight, setDetails };
  });

  const hasInvalid = exercises.some(
    (e) => !e.name || e.sets === 0
  );

  if (hasInvalid) {
    throw new Error("Uzupełnij poprawnie wszystkie pola ćwiczeń.");
  }

  return exercises;
}

async function deleteWorkoutFromWorkoutsPage(workoutId) {
  if (!auth.currentUser) {
    return;
  }

  const workoutSnap = await getDoc(doc(db, "workouts", workoutId));
  if (!workoutSnap.exists()) {
    return;
  }

  const workoutData = workoutSnap.data();
  if (workoutData.userId !== auth.currentUser.uid) {
    throw new Error("Nie możesz usunąć cudzego treningu.");
  }

  const shouldDelete = window.confirm("Czy na pewno chcesz usunąć ten trening?");
  if (!shouldDelete) {
    return;
  }

  hideMessages();
  toggleLoading(true);

  try {
    const q = query(collection(db, "exercises"), where("workoutId", "==", workoutId));
    const snapshot = await getDocs(q);

    await Promise.all(snapshot.docs.map((exerciseDoc) => deleteDoc(doc(db, "exercises", exerciseDoc.id))));
    await deleteDoc(doc(db, "workouts", workoutId));

    showSuccess("Trening został usunięty.");
    await initWorkoutsPage(auth.currentUser);
  } finally {
    toggleLoading(false);
  }
}

async function getUserProfile(userId) {
  const userSnap = await getDoc(doc(db, "users", userId));
  return userSnap.exists() ? userSnap.data() : null;
}

async function getUserProfileSafe(userId) {
  try {
    return await getUserProfile(userId);
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      return null;
    }

    throw error;
  }
}

async function getUserWorkouts(userId) {
  const q = query(collection(db, "workouts"), where("userId", "==", userId));
  const snapshot = await getDocs(q);

  const workouts = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  return workouts.sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function getUserWorkoutsSafe(userId) {
  try {
    return await getUserWorkouts(userId);
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      return [];
    }

    throw error;
  }
}

async function getAllWorkouts() {
  const snapshot = await getDocs(collection(db, "workouts"));

  return snapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function getAllWorkoutsSafe() {
  try {
    const workouts = await getAllWorkouts();
    return { workouts, hasPermission: true };
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      return { workouts: [], hasPermission: false };
    }

    throw error;
  }
}

async function getAllExercisesSafe() {
  try {
    const snapshot = await getDocs(collection(db, "exercises"));
    const exercises = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    return { exercises, hasPermission: true };
  } catch (error) {
    if (String(error?.code || "").includes("permission-denied")) {
      return { exercises: [], hasPermission: false };
    }

    throw error;
  }
}

function indexExercisesByWorkout(exercises = []) {
  return exercises.reduce((acc, exercise) => {
    const workoutId = exercise?.workoutId;
    if (!workoutId) {
      return acc;
    }

    if (!acc[workoutId]) {
      acc[workoutId] = [];
    }

    acc[workoutId].push(exercise);
    return acc;
  }, {});
}

function normalizeExerciseName(name) {
  return String(name || "").trim().toLowerCase();
}

const WORKOUT_POINTS = 100;
const PB_POINTS = 50;
const WEEKLY_WINNER_BONUS_POINTS = 250;

function calculateBasePointsByUser(workouts = [], exercisesByWorkout = {}, recentCutoffDate = null) {
  const workoutsByUser = new Map();

  workouts.forEach((workout) => {
    if (!workout?.userId || !workout?.date) {
      return;
    }

    if (!workoutsByUser.has(workout.userId)) {
      workoutsByUser.set(workout.userId, []);
    }

    workoutsByUser.get(workout.userId).push(workout);
  });

  const pointsByUser = new Map();

  workoutsByUser.forEach((userWorkouts, userId) => {
    const sorted = userWorkouts
      .slice()
      .sort((first, second) => new Date(first.date) - new Date(second.date));
    const pbMaxByExercise = new Map();

    let total = 0;
    let recent = 0;
    let pbHits = 0;

    sorted.forEach((workout) => {
      let workoutPoints = WORKOUT_POINTS;
      const exercises = exercisesByWorkout[workout.id] || [];

      exercises.forEach((exercise) => {
        const normalizedName = normalizeExerciseName(exercise.name);
        if (!normalizedName) {
          return;
        }

        const weight = Number(exercise.weight);
        if (!Number.isFinite(weight)) {
          return;
        }

        const previousMax = pbMaxByExercise.get(normalizedName);
        if (previousMax === undefined || weight > previousMax) {
          workoutPoints += PB_POINTS;
          pbHits += 1;
          pbMaxByExercise.set(normalizedName, weight);
        }
      });

      total += workoutPoints;

      if (recentCutoffDate) {
        const workoutDate = new Date(workout.date);
        workoutDate.setHours(0, 0, 0, 0);
        if (!Number.isNaN(workoutDate.getTime()) && workoutDate >= recentCutoffDate) {
          recent += workoutPoints;
        }
      }
    });

    pointsByUser.set(userId, {
      total,
      recent,
      pbHits,
      workoutsCount: sorted.length,
    });
  });

  return pointsByUser;
}

function calculatePointsByUser(
  workouts = [],
  exercisesByWorkout = {},
  recentCutoffDate = null,
  includeWeeklyWinnerBonus = true
) {
  const pointsByUser = calculateBasePointsByUser(workouts, exercisesByWorkout, recentCutoffDate);

  if (!includeWeeklyWinnerBonus) {
    return pointsByUser;
  }

  const workoutsByWeek = new Map();
  const currentWeekKey = getISOWeekKey(new Date());

  workouts.forEach((workout) => {
    if (!workout?.userId || !workout?.date) {
      return;
    }

    const workoutDate = new Date(workout.date);
    if (Number.isNaN(workoutDate.getTime())) {
      return;
    }

    const weekKey = getISOWeekKey(workoutDate);
    if (!workoutsByWeek.has(weekKey)) {
      workoutsByWeek.set(weekKey, []);
    }

    workoutsByWeek.get(weekKey).push(workout);
  });

  workoutsByWeek.forEach((weekWorkouts, weekKey) => {
    // Bonus przyznajemy po zamknieciu tygodnia (bez biezacego tygodnia).
    if (weekKey === currentWeekKey) {
      return;
    }

    const weekPointsByUser = calculateBasePointsByUser(weekWorkouts, exercisesByWorkout, null);
    const winner = [...weekPointsByUser.entries()]
      .map(([userId, data]) => ({
        userId,
        points: data.total,
        workoutsCount: data.workoutsCount,
      }))
      .filter((entry) => entry.points > 0)
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.workoutsCount - a.workoutsCount ||
          a.userId.localeCompare(b.userId)
      )[0];

    if (!winner) {
      return;
    }

    const weekStart = startOfISOWeek(new Date(weekWorkouts[0].date));
    const awardDate = new Date(weekStart);
    awardDate.setDate(awardDate.getDate() + 6);
    awardDate.setHours(0, 0, 0, 0);

    const current = pointsByUser.get(winner.userId) || {
      total: 0,
      recent: 0,
      pbHits: 0,
      workoutsCount: 0,
    };

    current.total += WEEKLY_WINNER_BONUS_POINTS;
    if (recentCutoffDate && awardDate >= recentCutoffDate) {
      current.recent += WEEKLY_WINNER_BONUS_POINTS;
    }

    pointsByUser.set(winner.userId, current);
  });

  return pointsByUser;
}

async function getExercisesByWorkoutIds(workoutIds) {
  if (!workoutIds.length) {
    return {};
  }

  // Firestore nie wspiera prostego join, dlatego pobieramy ćwiczenia per trening.
  const entries = await Promise.all(
    workoutIds.map(async (workoutId) => {
      const q = query(collection(db, "exercises"), where("workoutId", "==", workoutId));
      const snapshot = await getDocs(q);
      const exercises = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      return [workoutId, exercises];
    })
  );

  return Object.fromEntries(entries);
}

function renderLastWorkout(workouts, exercisesByWorkout) {
  const container = document.getElementById("lastWorkoutContent");
  if (!container) {
    return;
  }

  if (!workouts.length) {
    container.innerHTML = "<p class='text-muted'>Nie masz jeszcze zadnego treningu.</p>";
    return;
  }

  const latest = workouts[0];
  const exercises = exercisesByWorkout[latest.id] || [];

  if (!exercises.length) {
    container.innerHTML = `
      <p class="last-workout-date"><strong>${formatDate(latest.date)}</strong></p>
      <p class="last-workout-notes text-muted">${escapeHtml(latest.title || "Trening")}</p>
      <p class="text-muted">Brak ćwiczeń w tym treningu.</p>
    `;
    return;
  }

  const listItems = exercises
    .slice(0, 5)
    .map(
      (exercise) =>
        `<li><strong>${escapeHtml(exercise.name)}</strong> - ${exercise.sets}x${exercise.reps} @ ${exercise.weight} kg</li>`
    )
    .join("");

  container.innerHTML = `
    <p class="last-workout-date"><strong>${formatDate(latest.date)}</strong></p>
    <p class="last-workout-notes text-muted">${escapeHtml(latest.title || "Trening")}</p>
    <ul class="compact-list">${listItems}</ul>
  `;
}

function renderWorkoutHistory(workouts, exercisesByWorkout) {
  const historyList = document.getElementById("historyList");
  const historyToggleBtn = document.getElementById("historyToggleBtn");
  if (!historyList) {
    return;
  }

  if (historyToggleBtn) {
    historyToggleBtn.onclick = null;
  }

  if (!workouts.length) {
    historyList.innerHTML = "<li>Brak historii treningów.</li>";
    if (historyToggleBtn) {
      historyToggleBtn.classList.add("hidden");
    }
    return;
  }


  const visibleItems = homeHistoryExpanded ? workouts : workouts.slice(0, 6);
  const items = visibleItems.map((workout) => {
    const title = workout.title ? escapeHtml(workout.title) : "Trening";
    return `
      <li class="history-entry minimalist-history-entry">
        <span class="history-date">${formatDate(workout.date)}</span>
        <span class="history-title">${title}</span>
      </li>
    `;
  });

  historyList.innerHTML = items.join("");

  if (historyToggleBtn) {
    if (workouts.length > 6) {
      historyToggleBtn.classList.remove("hidden");
      historyToggleBtn.textContent = homeHistoryExpanded ? "Pokaż mniej" : "Pokaż więcej";
      historyToggleBtn.onclick = () => {
        homeHistoryExpanded = !homeHistoryExpanded;
        renderWorkoutHistory(workouts, exercisesByWorkout);
      };
    } else {
      historyToggleBtn.classList.add("hidden");
    }
  }
}

async function renderGlobalRanking(workouts, exercisesByWorkout, hasPermission = true, currentUserId = "", rangeDays = 7) {
  const rankingSummaryEl = document.getElementById("rankingSummary");
  const rankingEmptyEl = document.getElementById("rankingEmpty");
  const rankingListEl = document.getElementById("rankingList");

  if (!rankingSummaryEl || !rankingEmptyEl || !rankingListEl) {
    return;
  }

  rankingSummaryEl.textContent = "";
  rankingSummaryEl.classList.add("hidden");

  if (!hasPermission) {
    rankingEmptyEl.textContent = "Ranking jest ukryty do czasu wlaczenia odczytu workouts i exercises dla zalogowanych użytkowników.";
    rankingEmptyEl.classList.remove("hidden");
    rankingListEl.innerHTML = "<li>Brak danych rankingu.</li>";
    return;
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  const safeRangeDays = getSafeGlobalRangeDays(rangeDays);
  cutoff.setDate(cutoff.getDate() - (safeRangeDays - 1));

  const recentWorkouts = workouts.filter((workout) => {
    if (!workout?.date || !workout?.userId) {
      return false;
    }

    const date = new Date(workout.date);
    date.setHours(0, 0, 0, 0);
    return !Number.isNaN(date.getTime()) && date >= cutoff;
  });

  const countsByUser = new Map();
  recentWorkouts.forEach((workout) => {
    countsByUser.set(workout.userId, (countsByUser.get(workout.userId) || 0) + 1);
  });

  const pointsByUser = calculatePointsByUser(workouts, exercisesByWorkout, cutoff);

  const ranking = [...countsByUser.entries()]
    .map(([userId, workoutsInRange]) => ({
      userId,
      workoutsInRange,
      points: pointsByUser.get(userId)?.recent || workoutsInRange * 100,
    }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 8);

  const profiles = await Promise.all(
    ranking.map(async (entry) => ({
      userId: entry.userId,
      profile: await getUserProfileSafe(entry.userId),
    }))
  );
  const profileById = new Map(profiles.map((entry) => [entry.userId, entry.profile]));

  if (!ranking.length) {
    rankingEmptyEl.classList.remove("hidden");
    rankingListEl.innerHTML = "<li>Brak aktywności w rankingu.</li>";
    return;
  }

  rankingEmptyEl.classList.add("hidden");
  const bestValue = ranking[0].points || 1;

  rankingListEl.innerHTML = ranking
    .map((entry, index) => {
      const place = index + 1;
      const isCurrentUser = currentUserId && entry.userId === currentUserId;
      const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : "#";
      const profile = profileById.get(entry.userId) || null;
      const label = isCurrentUser
        ? "Ty"
        : profile?.name || `Użytkownik ${entry.userId.slice(0, 4).toUpperCase()}`;
      const avatar = profile?.photoURL || "";
      const ratio = Math.max(12, (entry.points / bestValue) * 100);

      return `
        <li class="ranking-item${isCurrentUser ? " ranking-item-me" : ""}">
          <div class="ranking-head">
            <span class="ranking-place">${medal} ${place}</span>
            <span class="ranking-user-wrap">
              ${avatar
                ? `<img src="${escapeHtml(avatar)}" alt="Avatar" class="ranking-avatar" />`
                : `<span class="ranking-avatar ranking-avatar-fallback">${getInitial(label)}</span>`}
              <span class="ranking-user">${escapeHtml(label)}</span>
              <span class="ranking-user-points">${entry.points} pkt</span>
            </span>
            <span class="ranking-score">${entry.workoutsInRange}</span>
          </div>
          <div class="ranking-track">
            <div class="ranking-fill" style="width: ${ratio}%"></div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderDashboardPoints(workouts, exercisesByWorkout, globalPointsEntry = null) {
  const totalEl = document.getElementById("dashboardPointsTotal");

  if (!totalEl) {
    return;
  }

  const localPoints = calculatePointsByUser(
    workouts.map((workout) => ({ ...workout, userId: "current-user" })),
    exercisesByWorkout,
    null,
    false
  ).get("current-user") || { total: 0, pbHits: 0, workoutsCount: 0 };

  const points = globalPointsEntry || localPoints;

  totalEl.textContent = `${points.total} pkt`;
}

function renderPB(workouts, exercisesByWorkout) {
  const pbList = document.getElementById("pbList");
  if (!pbList) {
    return;
  }

  if (!workouts.length) {
    pbList.innerHTML = "<li>Brak rekordów. Dodaj pierwszy trening.</li>";
    return;
  }

  // Use normalized names for grouping
  const pbMap = new Map();
  const nameMap = new Map(); // normalizedName -> originalName

  workouts.forEach((workout) => {
    const exercises = exercisesByWorkout[workout.id] || [];

    exercises.forEach((exercise) => {
      const rawName = exercise.name || "Nieznane";
      const normalizedName = normalizeExerciseName(rawName);
      const weight = Number(exercise.weight) || 0;
      const current = pbMap.get(normalizedName) || 0;

      if (weight > current) {
        pbMap.set(normalizedName, weight);
        nameMap.set(normalizedName, rawName);
      }
    });
  });

  if (!pbMap.size) {
    pbList.innerHTML = "<li>Brak rekordów. Dodaj ćwiczenia z ciężarem.</li>";
    return;
  }

  const rows = [...pbMap.entries()]
    .sort((a, b) => nameMap.get(a[0]).localeCompare(nameMap.get(b[0]), "pl"))
    .map(
      ([normalizedName, weight]) =>
        `<li class="pb-item"><span>${escapeHtml(nameMap.get(normalizedName))}</span><strong class="pb-weight">${weight} kg</strong></li>`
    );

  pbList.innerHTML = rows.join("");
}

function renderDashboardStats(workouts, exercisesByWorkout, range = dashboardStrengthRange, userProfile = null) {
  renderDashboardOverview(workouts, exercisesByWorkout);
  renderFormScoreCard(workouts, exercisesByWorkout, range, userProfile);
  renderMetricsChart(workouts, exercisesByWorkout, range);
  renderPBFeed(workouts, exercisesByWorkout);
  renderTrainingHeatmap(workouts);
  renderBestTrainingWindow(workouts);
  renderTopExercisesPro(workouts, exercisesByWorkout);
}

function setupDashboardRangeToggle(onRangeChange) {
  const toggle = document.getElementById("strengthRangeToggle");
  if (!toggle) {
    return;
  }

  const buttons = [...toggle.querySelectorAll(".range-btn[data-strength-range]")];
  buttons.forEach((button) => {
    const value = Number(button.dataset.strengthRange);
    if (!Number.isFinite(value)) {
      return;
    }

    button.classList.toggle("active", value === dashboardStrengthRange);

    button.onclick = () => {
      dashboardStrengthRange = value;
      buttons.forEach((item) => {
        const itemValue = Number(item.dataset.strengthRange);
        item.classList.toggle("active", itemValue === dashboardStrengthRange);
      });

      if (typeof onRangeChange === "function") {
        onRangeChange(dashboardStrengthRange);
      }
    };
  });
}

function getDashboardRangeCutoffDate(rangeDays) {
  const parsedRange = Number(rangeDays);
  const safeRange = Number.isFinite(parsedRange) && parsedRange > 0 ? parsedRange : 30;
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (safeRange - 1));
  return cutoff;
}

function filterWorkoutsByRange(workouts, rangeDays) {
  const cutoff = getDashboardRangeCutoffDate(rangeDays);

  return workouts.filter((workout) => {
    const workoutDate = new Date(workout.date);
    workoutDate.setHours(0, 0, 0, 0);
    return !Number.isNaN(workoutDate.getTime()) && workoutDate >= cutoff;
  });
}

function pickExercisesByWorkoutIds(exercisesByWorkout, workoutIds) {
  const scoped = {};
  workoutIds.forEach((id) => {
    scoped[id] = exercisesByWorkout[id] || [];
  });
  return scoped;
}

function renderDashboardOverview(workouts, exercisesByWorkout) {
  const totalEl = document.getElementById("overviewTotalWorkouts");
  const weekEl = document.getElementById("overviewWeekWorkouts");
  const activeDaysEl = document.getElementById("overviewActiveDays");
  const exerciseCountEl = document.getElementById("overviewExerciseCount");

  if (!totalEl || !weekEl || !activeDaysEl || !exerciseCountEl) {
    return;
  }

  const total = workouts.length;
  const week = workouts.filter((workout) => isInCurrentWeek(workout.date)).length;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

  const activeDays = new Set(
    workouts
      .filter((workout) => {
        const date = new Date(workout.date);
        return !Number.isNaN(date.getTime()) && date >= thirtyDaysAgo;
      })
      .map((workout) => workout.date)
  ).size;

  const exerciseCount = workouts.reduce(
    (sum, workout) => sum + (exercisesByWorkout[workout.id] || []).length,
    0
  );

  totalEl.textContent = String(total);
  weekEl.textContent = String(week);
  activeDaysEl.textContent = String(activeDays);
  exerciseCountEl.textContent = String(exerciseCount);
}

function renderDashboardStrengthChart(workouts, exercisesByWorkout, range = 30) {
  const canvas = document.getElementById("strengthChart");
  const summaryEl = document.getElementById("strengthSummary");

  if (!canvas || !summaryEl) {
    return;
  }

  const rangeDays = Number.isFinite(Number(range)) ? Number(range) : 30;

  const series = workouts
    .slice()
    .reverse()
    .map((workout) => {
      const exercises = exercisesByWorkout[workout.id] || [];
      const maxWeight = exercises.reduce((max, exercise) => Math.max(max, Number(exercise.weight) || 0), 0);
      return {
        label: formatDate(workout.date),
        value: maxWeight,
      };
    })
    .filter((point) => point.value > 0);

  if (!series.length) {
    summaryEl.textContent = "Brak danych ciężaru do wykresu progresu siłowego.";
    clearCanvas(canvas);
    return;
  }

  const start = series[0].value;
  const end = series[series.length - 1].value;
  const delta = end - start;
  const sign = delta > 0 ? "+" : "";
  const rangeLabel = DASHBOARD_STRENGTH_RANGE_LABELS[rangeDays] || `${rangeDays} dni`;
  summaryEl.textContent = `Najwyższy ciężar, zakres ${rangeLabel}, zmiana ${sign}${delta.toFixed(1)} kg`;

  drawDashboardStrengthLine(canvas, series);
}

function clearCanvas(canvas) {
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawDashboardStrengthLine(canvas, series) {
  const context = canvas.getContext("2d");
  const parentWidth = canvas.parentElement.clientWidth || 320;
  const cssWidth = Math.max(parentWidth, 320);
  const cssHeight = 260;
  const dpr = window.devicePixelRatio || 1;

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(dpr, dpr);

  const padding = { top: 18, right: 18, bottom: 18, left: 46 };
  const chartWidth = cssWidth - padding.left - padding.right;
  const chartHeight = cssHeight - padding.top - padding.bottom;
  const chartBottom = padding.top + chartHeight;

  const values = series.map((point) => point.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(10, Math.round((maxValue - minValue || 20) * 0.18));
  const chartMin = Math.max(0, Math.floor((minValue - valuePadding) / 20) * 20);
  const chartMax = Math.ceil((maxValue + valuePadding) / 20) * 20;
  const span = Math.max(chartMax - chartMin, 1);

  context.fillStyle = "rgba(16, 18, 22, 0.98)";
  roundRect(context, 0, 0, cssWidth, cssHeight, 16);
  context.fill();

  context.lineWidth = 1;
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.font = "11px Manrope";
  context.fillStyle = "rgba(255, 255, 255, 0.42)";

  for (let i = 0; i <= 4; i += 1) {
    const value = chartMax - (span / 4) * i;
    const y = padding.top + (chartHeight / 4) * i;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(cssWidth - padding.right, y);
    context.stroke();
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(Math.round(value).toLocaleString("pl-PL"), 8, y);
  }

  const points = series.map((point, index) => {
    const x =
      padding.left +
      (series.length === 1 ? chartWidth / 2 : (chartWidth / (series.length - 1)) * index);
    const y = padding.top + chartHeight - ((point.value - chartMin) / span) * chartHeight;
    return { x, y, value: point.value, label: point.label };
  });

  const stepPath = new Path2D();
  stepPath.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    stepPath.lineTo(points[index].x, points[index - 1].y);
    stepPath.lineTo(points[index].x, points[index].y);
  }

  const areaPath = new Path2D();
  areaPath.moveTo(points[0].x, chartBottom);
  areaPath.lineTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    areaPath.lineTo(points[index].x, points[index - 1].y);
    areaPath.lineTo(points[index].x, points[index].y);
  }
  areaPath.lineTo(points[points.length - 1].x, chartBottom);
  areaPath.closePath();

  context.fillStyle = "rgba(255, 129, 55, 0.22)";
  context.fill(areaPath);

  context.strokeStyle = "#ff8137";
  context.lineWidth = 4;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.shadowColor = "rgba(255, 129, 55, 0.28)";
  context.shadowBlur = 16;
  context.stroke(stepPath);
  context.shadowBlur = 0;

  const highlightPoints = getChartHighlightPoints(points);
  highlightPoints.forEach((point) => {
    context.fillStyle = "#ff8137";
    context.beginPath();
    context.arc(point.x, point.y, 7, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#17191d";
    context.beginPath();
    context.arc(point.x, point.y, 4.2, 0, Math.PI * 2);
    context.fill();

    const label = Math.round(point.value).toLocaleString("pl-PL");
    const metrics = context.measureText(label);
    const labelWidth = Math.max(54, metrics.width + 18);
    const labelHeight = 26;
    const labelX = Math.min(cssWidth - padding.right - labelWidth, Math.max(padding.left, point.x - (labelWidth / 2)));
    const labelY = Math.max(8, point.y - 40);

    context.fillStyle = "#ff8137";
    roundRect(context, labelX, labelY, labelWidth, labelHeight, 10);
    context.fill();

    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 11px Manrope";
    context.fillText(label, labelX + (labelWidth / 2), labelY + (labelHeight / 2) + 0.5);
  });
}

function getChartHighlightPoints(points) {
  if (!points.length) {
    return [];
  }

  const localPeaks = points.filter((point, index) => {
    const previous = points[index - 1]?.value ?? -Infinity;
    const next = points[index + 1]?.value ?? -Infinity;
    return point.value >= previous && point.value >= next;
  });

  return [...localPeaks, points[points.length - 1]]
    .filter((point, index, array) => array.findIndex((item) => item.x === point.x) === index)
    .sort((first, second) => second.value - first.value)
    .slice(0, 2)
    .sort((first, second) => first.x - second.x);
}

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function renderDashboardRecords(workouts, exercisesByWorkout) {
  const recordsList = document.getElementById("dashboardRecordsList");
  if (!recordsList) {
    return;
  }

  // Use normalized names for grouping
  const pbMap = new Map();
  const nameMap = new Map(); // normalizedName -> originalName
  workouts.forEach((workout) => {
    (exercisesByWorkout[workout.id] || []).forEach((exercise) => {
      const rawName = exercise.name || "Nieznane";
      const normalizedName = normalizeExerciseName(rawName);
      const weight = Number(exercise.weight) || 0;
      if (weight > (pbMap.get(normalizedName) || 0)) {
        pbMap.set(normalizedName, weight);
        nameMap.set(normalizedName, rawName);
      }
    });
  });

  if (!pbMap.size) {
    recordsList.innerHTML = "<li>Brak rekordów.</li>";
    return;
  }

  recordsList.innerHTML = [...pbMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(
      ([normalizedName, weight]) =>
        `<li class="pb-item"><span>${escapeHtml(nameMap.get(normalizedName))}</span><strong class="pb-weight">${weight} kg</strong></li>`
    )
    .join("");
}

function renderDashboardFrequency(workouts) {
  const frequencyList = document.getElementById("dashboardFrequencyList");
  if (!frequencyList) {
    return;
  }

  const dayLabels = ["Pon", "Wt", "Sr", "Czw", "Pt", "Sob", "Niedz"];
  const counts = new Array(7).fill(0);

  workouts.forEach((workout) => {
    const date = new Date(workout.date);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const jsDay = date.getDay();
    const index = jsDay === 0 ? 6 : jsDay - 1;
    counts[index] += 1;
  });

  const maxCount = Math.max(...counts, 1);

  frequencyList.innerHTML = dayLabels
    .map((label, index) => {
      const count = counts[index];
      const width = count === 0 ? 8 : Math.max(12, (count / maxCount) * 100);

      return `
        <li class="frequency-item">
          <span class="frequency-day">${label}</span>
          <div class="frequency-track"><div class="frequency-fill" style="width:${width}%"></div></div>
          <span class="frequency-count">${count}</span>
        </li>
      `;
    })
    .join("");
}

function renderDashboardTopExercises(workouts, exercisesByWorkout) {
  const topExercisesEl = document.getElementById("dashboardTopExercises");
  if (!topExercisesEl) {
    return;
  }

  const freqMap = new Map();
  workouts.forEach((workout) => {
    (exercisesByWorkout[workout.id] || []).forEach((exercise) => {
      const key = exercise.name || "Nieznane";
      freqMap.set(key, (freqMap.get(key) || 0) + 1);
    });
  });

  const topRows = [...freqMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `<li><strong>${escapeHtml(name)}</strong> - ${count}x</li>`);

  topExercisesEl.innerHTML = topRows.length ? topRows.join("") : "<li>Brak danych.</li>";
}

function renderDashboardHeatmap(workouts, exercisesByWorkout) {
  const heatmapEl = document.getElementById("dashboardHeatmap");
  const summaryEl = document.getElementById("dashboardVolumeSummary");
  if (!heatmapEl || !summaryEl) {
    return;
  }

  const volumeByDate = new Map();
  workouts.forEach((workout) => {
    const exercises = exercisesByWorkout[workout.id] || [];
    const volume = exercises.reduce(
      (sum, exercise) => sum + (Number(exercise.sets) || 0) * (Number(exercise.reps) || 0) * (Number(exercise.weight) || 0),
      0
    );
    volumeByDate.set(workout.date, (volumeByDate.get(workout.date) || 0) + volume);
  });

  const totalVolume = [...volumeByDate.values()].reduce((a, b) => a + b, 0);
  summaryEl.textContent = `Łączna objętość: ${Math.round(totalVolume).toLocaleString("pl-PL")} kg (sets x reps x ciężar)`;

  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 83; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const key = formatDateForInput(date);
    days.push({ key, volume: volumeByDate.get(key) || 0 });
  }

  const maxVolume = Math.max(...days.map((day) => day.volume), 1);
  heatmapEl.innerHTML = days
    .map((day) => {
      const ratio = day.volume / maxVolume;
      const alpha = day.volume === 0 ? 0.06 : Math.min(0.9, 0.18 + ratio * 0.72);
      const title = `${day.key}: ${Math.round(day.volume)} kg`;
      return `<span class="heatmap-cell" title="${title}" style="background: rgba(32, 40, 50, ${alpha});"></span>`;
    })
    .join("");
}

function calculateProgress(workouts, exercisesByWorkout) {
  if (workouts.length < 2) {
    return null;
  }

  const avgWeightPerWorkout = workouts.map((workout) => {
    const exercises = exercisesByWorkout[workout.id] || [];
    if (!exercises.length) {
      return 0;
    }

    const sum = exercises.reduce((acc, exercise) => acc + (Number(exercise.weight) || 0), 0);
    return sum / exercises.length;
  });

  const recent = avgWeightPerWorkout.slice(0, 3);
  const previous = avgWeightPerWorkout.slice(3, 6);

  if (!previous.length) {
    return null;
  }

  const recentAvg = recent.reduce((acc, value) => acc + value, 0) / recent.length;
  const previousAvg = previous.reduce((acc, value) => acc + value, 0) / previous.length;

  if (previousAvg <= 0) {
    return null;
  }

  return ((recentAvg - previousAvg) / previousAvg) * 100;
}

function isInCurrentWeek(dateString) {
  if (!dateString) {
    return false;
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;

  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() + mondayOffset);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return date >= startOfWeek && date < endOfWeek;
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(dateString) {
  if (!dateString) {
    return "-";
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return dateString;
  }

  return date.toLocaleDateString("pl-PL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return "";
  }

  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate().toLocaleDateString("pl-PL", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  return "";
}

function getInitial(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "P";
  }

  return normalized[0].toUpperCase();
}

function formatTrainingCount(value) {
  const count = Math.max(0, Number(value) || 0);
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (count === 1) {
    return `${count} trening`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} treningi`;
  }

  return `${count} treningów`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toggleLoading(show, id = "pageLoading") {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.classList.toggle("hidden", !show);
}

function hideMessages() {
  ["pageError", "pageSuccess", "authError"].forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.add("hidden");
      element.textContent = "";
    }
  });
}

function showError(message, id = "pageError") {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.remove("hidden");
}

function showSuccess(message, id = "pageSuccess") {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.remove("hidden");
}

function getFriendlyError(error) {
  if (!error) {
    return "Wystapil nieznany blad.";
  }

  const code = error.code || "";

  if (code.includes("auth/email-already-in-use")) {
    return "Ten email jest juz zajety.";
  }

  if (code.includes("auth/invalid-email")) {
    return "Niepoprawny email.";
  }

  if (code.includes("auth/weak-password")) {
    return "Hasło jest za słabe (minimum 6 znakow).";
  }

  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Niepoprawny email lub hasło.";
  }

  if (code.includes("auth/user-not-found")) {
    return "Użytkownik nie istnieje.";
  }

  if (code.includes("permission-denied")) {
    return "Brak uprawnien do odczytu danych. Sprawdz reguly Firestore.";
  }

  if (error.message) {
    return error.message;
  }

  return "Wystapil blad. Sprobuj ponownie.";
}

// ============ FORMA TYGODNIA - NEW DASHBOARD COMPONENTS ============

function renderFormScoreCard(workouts, exercisesByWorkout, range = 30, userProfile = null) {
  const scoreEl = document.getElementById("formScoreValue");
  const badgeEl = document.getElementById("formScoreBadge");
  const insightEl = document.getElementById("formInsightText");
  const strengthFillEl = document.getElementById("formMetricStrength");
  const regularityFillEl = document.getElementById("formMetricRegularity");
  const volumeFillEl = document.getElementById("formMetricVolume");
  const strengthValueEl = document.getElementById("formMetricStrengthValue");
  const regularityValueEl = document.getElementById("formMetricRegularityValue");
  const volumeValueEl = document.getElementById("formMetricVolumeValue");

  if (!scoreEl || !badgeEl || !insightEl) return;

  // Calculate metrics
  const metrics = calculateFormMetrics(workouts, exercisesByWorkout, range, userProfile);
  
  // Form score is average of three components
  const score = Math.round((metrics.strength + metrics.regularity + metrics.volume) / 3);
  
  // Display main score
  scoreEl.textContent = score;
  badgeEl.textContent = getScoreBadgeText(score);
  badgeEl.className = `pill score-badge-${getScoreLevel(score)}`;
  
  // Update metric bars
  if (strengthFillEl) {
    strengthFillEl.style.width = `${metrics.strength}%`;
    strengthValueEl.textContent = `${Math.round(metrics.strength)}%`;
  }
  if (regularityFillEl) {
    regularityFillEl.style.width = `${metrics.regularity}%`;
    regularityValueEl.textContent = `${Math.round(metrics.regularity)}%`;
  }
  if (volumeFillEl) {
    volumeFillEl.style.width = `${metrics.volume}%`;
    volumeValueEl.textContent = `${Math.round(metrics.volume)}%`;
  }
  
  // Generate insight
  const insight = generateFormInsight(metrics, workouts);
  insightEl.textContent = insight;
}

function calculateFormMetrics(workouts, exercisesByWorkout, range = 30, userProfile = null) {
  if (!workouts || !workouts.length) {
    return { strength: 0, regularity: 0, volume: 0 };
  }

  // 1. STRENGTH: Trend of max weight
  const strength = calculateStrengthTrend(workouts, exercisesByWorkout) * 100;

  // 2. REGULARITY: Workouts vs weekly goal
  const regularity = calculateRegularityScore(workouts, range, userProfile) * 100;

  // 3. VOLUME: Total volume trend
  const volume = calculateVolumeProgress(workouts, exercisesByWorkout) * 100;

  return {
    strength: Math.max(0, Math.min(100, strength)),
    regularity: Math.max(0, Math.min(100, regularity)),
    volume: Math.max(0, Math.min(100, volume)),
  };
}

function calculateStrengthTrend(workouts, exercisesByWorkout) {
  if (!workouts || !workouts.length) return 0.5;

  const sorted = [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recentThird = sorted.slice(-Math.max(1, Math.floor(sorted.length / 3)));
  const olderThird = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 3)));

  const getMaxWeight = (workouts) => {
    let max = 0;
    workouts.forEach((w) => {
      (exercisesByWorkout[w.id] || []).forEach((e) => {
        max = Math.max(max, Number(e.weight) || 0);
      });
    });
    return max;
  };

  const recentMax = getMaxWeight(recentThird);
  const olderMax = getMaxWeight(olderThird);

  if (olderMax === 0) return 0.5;
  
  const trend = (recentMax - olderMax) / Math.max(olderMax, 1);
  return Math.max(0.1, Math.min(0.9, 0.5 + trend * 0.4));
}

function calculateRegularityScore(workouts, range = 30, userProfile = null) {
  if (!workouts || !workouts.length) return 0.3;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - range);

  const recentWorkouts = workouts.filter((w) => new Date(w.date) >= cutoff);
  const weeks = Math.ceil(range / 7);
  const workoutsPerWeek = weeks > 0 ? recentWorkouts.length / weeks : 0;

  const weeklyGoal = Math.max(1, Number(userProfile?.weeklyGoal) || 3);
  const score = Math.min(1, workoutsPerWeek / weeklyGoal);
  return score;
}

function calculateVolumeProgress(workouts, exercisesByWorkout) {
  if (!workouts || !workouts.length) return 0.5;

  const sorted = [...workouts].sort((a, b) => new Date(a.date) - new Date(b.date));
  const mid = Math.floor(sorted.length / 2);

  const getVolume = (workouts) => {
    let volume = 0;
    workouts.forEach((w) => {
      (exercisesByWorkout[w.id] || []).forEach((e) => {
        const weight = Number(e.weight) || 0;
        const reps = Number(e.reps) || 0;
        const sets = Number(e.sets) || 0;
        volume += weight * reps * sets;
      });
    });
    return volume;
  };

  const recentVolume = getVolume(sorted.slice(mid));
  const olderVolume = getVolume(sorted.slice(0, mid));

  if (olderVolume === 0) return 0.5;
  
  const trend = (recentVolume - olderVolume) / Math.max(olderVolume, 1);
  return Math.max(0.1, Math.min(0.9, 0.5 + trend * 0.3));
}

function generateFormInsight(metrics, workouts) {
  const issues = [];

  if (metrics.strength < 40) {
    issues.push("Brak progresji siłowej");
  } else if (metrics.strength > 70) {
    issues.push("Świetnie rosniesz siłowo!");
  }

  if (metrics.regularity < 50) {
    issues.push("Brakuje regularności treningów");
  }

  if (metrics.volume < 40) {
    issues.push("Spadła objętość treningów");
  } else if (metrics.volume > 80) {
    issues.push("Świetna objętość treningów!");
  }

  if (!issues.length) {
    const recent = workouts.slice(-3).length;
    if (recent < 2) {
      return "Zaplanuj trening na kolejne dni";
    }
    return "Forma jest stabilna, utrzymuj rytm";
  }

  return issues.slice(0, 2).join(" i ");
}

function getScoreLevel(score) {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "fair";
  return "poor";
}

function getScoreBadgeText(score) {
  if (score >= 85) return "Doskonała";
  if (score >= 70) return "Dobra";
  if (score >= 50) return "Średnia";
  if (score >= 30) return "Słaba";
  return "Kryzys";
}

function renderMetricsChart(workouts, exercisesByWorkout, range = 30) {
  const canvas = document.getElementById("metricsChart");
  const summaryEl = document.getElementById("metricsSummary");
  const insightEl = document.getElementById("metricsChartInsight");
  const comparisonEl = document.getElementById("metricsComparison");

  if (!canvas || !summaryEl) return;

  const metricBtns = document.querySelectorAll(".metric-btn");
  let activeMetric = "strength";

  metricBtns.forEach((btn) => {
    if (btn.classList.contains("active")) {
      activeMetric = btn.dataset.metric || "strength";
    }

    btn.onclick = () => {
      metricBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeMetric = btn.dataset.metric;
      renderMetricsChart(workouts, exercisesByWorkout, range);
    };
  });

  const series = getMetricSeries(workouts, exercisesByWorkout, activeMetric, range);

  if (!series || !series.length) {
    summaryEl.textContent = "Brak danych do wykresu.";
    clearCanvas(canvas);
    return;
  }

  const start = series[0].value;
  const end = series[series.length - 1].value;
  const delta = end - start;
  const sign = delta > 0 ? "+" : "";
  const metricLabel = getMetricLabel(activeMetric);

  summaryEl.textContent = `${metricLabel}, zmiana ${sign}${delta.toFixed(1)}`;

  if (insightEl) {
    insightEl.textContent = `${sign}${delta.toFixed(1)} ${getMetricUnit(activeMetric)}`;
  }

  if (comparisonEl) {
    const prevDelta = calculatePreviousPeriodDelta(series);
    const prevSign = prevDelta > 0 ? "+" : "";
    comparisonEl.textContent = `${prevSign}${prevDelta.toFixed(1)}%`;
    comparisonEl.className = prevDelta > 0 ? "insight-value text-success" : "insight-value text-warning";
  }

  const referenceValue = getReferenceAverage(series);
  drawMetricLineChart(canvas, series, activeMetric, referenceValue);
}

function getReferenceAverage(series) {
  if (series.length < 2) {
    return series[0]?.value || 0;
  }

  const half = Math.max(1, Math.floor(series.length / 2));
  const base = series.slice(0, half);
  return base.reduce((sum, point) => sum + point.value, 0) / Math.max(1, base.length);
}

function getMetricSeries(workouts, exercisesByWorkout, metric, range) {
  const sorted = [...workouts]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .reverse()
    .slice(0, range);

  if (!sorted.length) return [];

  return sorted
    .reverse()
    .map((workout) => {
      const exercises = exercisesByWorkout[workout.id] || [];
      let value = 0;

      if (metric === "strength") {
        value = exercises.reduce((max, e) => Math.max(max, Number(e.weight) || 0), 0);
      } else if (metric === "volume") {
        value = exercises.reduce((sum, e) => {
          return sum + (Number(e.weight) || 0) * (Number(e.reps) || 0) * (Number(e.sets) || 0);
        }, 0);
      } else if (metric === "density") {
        const totalVolume = exercises.reduce((sum, e) => {
          return sum + (Number(e.weight) || 0) * (Number(e.reps) || 0) * (Number(e.sets) || 0);
        }, 0);
        value = exercises.length > 0 ? totalVolume / exercises.length : 0;
      }

      return {
        label: formatDate(workout.date),
        value: value,
        date: workout.date,
      };
    })
    .filter((point) => point.value > 0);
}

function getMetricLabel(metric) {
  const labels = {
    strength: "Max. Ciężar",
    volume: "Całkowita Objętość",
    density: "Gęstość Treningu",
  };
  return labels[metric] || "Metryka";
}

function getMetricUnit(metric) {
  const units = {
    strength: "kg",
    volume: "kg×rep×set",
    density: "kg×rep×set",
  };
  return units[metric] || "";
}

function calculatePreviousPeriodDelta(series) {
  if (series.length < 2) return 0;

  const mid = Math.floor(series.length / 2);
  const recent = series.slice(mid).reduce((sum, p) => sum + p.value, 0) / Math.max(1, series.length - mid);
  const previous = series.slice(0, mid).reduce((sum, p) => sum + p.value, 0) / Math.max(1, mid);

  if (previous === 0) return 0;

  return ((recent - previous) / previous) * 100;
}

function drawMetricLineChart(canvas, series, metric, referenceValue = 0) {
  const context = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const parentWidth = canvas.parentElement.clientWidth || 320;
  const cssWidth = Math.max(parentWidth, 320);
  const cssHeight = 260;

  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(dpr, dpr);

  const padding = { top: 18, right: 18, bottom: 18, left: 46 };
  const chartWidth = cssWidth - padding.left - padding.right;
  const chartHeight = cssHeight - padding.top - padding.bottom;
  const chartBottom = padding.top + chartHeight;

  const values = series.map((p) => p.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const valuePadding = Math.max(10, Math.round((maxValue - minValue || 20) * 0.18));
  const chartMin = Math.max(0, Math.floor((minValue - valuePadding) / 20) * 20);
  const chartMax = Math.ceil((maxValue + valuePadding) / 20) * 20;
  const span = Math.max(chartMax - chartMin, 1);

  // Background
  context.fillStyle = "rgba(16, 18, 22, 0.98)";
  roundRect(context, 0, 0, cssWidth, cssHeight, 16);
  context.fill();

  // Grid lines
  context.lineWidth = 1;
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.font = "11px Manrope";
  context.fillStyle = "rgba(255, 255, 255, 0.42)";

  for (let i = 0; i <= 4; i++) {
    const value = chartMax - (span / 4) * i;
    const y = padding.top + (chartHeight / 4) * i;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(cssWidth - padding.right, y);
    context.stroke();
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(Math.round(value).toLocaleString("pl-PL"), 8, y);
  }

  if (referenceValue > 0) {
    const referenceY = padding.top + chartHeight - ((referenceValue - chartMin) / span) * chartHeight;
    context.setLineDash([6, 6]);
    context.strokeStyle = "rgba(255, 255, 255, 0.42)";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(padding.left, referenceY);
    context.lineTo(cssWidth - padding.right, referenceY);
    context.stroke();
    context.setLineDash([]);
  }

  // Calculate points
  const points = series.map((point, index) => ({
    x: padding.left + (series.length === 1 ? chartWidth / 2 : (chartWidth / (series.length - 1)) * index),
    y: padding.top + chartHeight - ((point.value - chartMin) / span) * chartHeight,
    value: point.value,
  }));

  // Draw area + line
  const areaPath = new Path2D();
 areaPath.moveTo(points[0].x, chartBottom);
  for (let i = 0; i < points.length; i++) {
    areaPath.lineTo(points[i].x, points[i].y);
  }
  areaPath.lineTo(points[points.length - 1].x, chartBottom);
  areaPath.closePath();

  context.fillStyle = "rgba(100, 200, 255, 0.22)";
  context.fill(areaPath);

  // Draw line
  context.strokeStyle = "#64c8ff";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.stroke();

  // Draw points
  points.forEach((p) => {
    context.fillStyle = "#64c8ff";
    context.beginPath();
    context.arc(p.x, p.y, 4, 0, Math.PI * 2);
    context.fill();
  });
}

function renderPBFeed(workouts, exercisesByWorkout) {
  const feedEl = document.getElementById("dashboardPBFeed");
  const streakEl = document.getElementById("pbStreakInfo");
  const badgeEl = document.getElementById("pbStreakBadge");

  if (!feedEl) return;

  // Get all PBs with dates
  const pbHistory = getPBHistory(workouts, exercisesByWorkout);

  if (!pbHistory.length) {
    feedEl.innerHTML = "<li>Brak rekordów.</li>";
    if (streakEl) streakEl.textContent = "Brak danych";
    if (badgeEl) badgeEl.textContent = "-";
    return;
  }

  // Calculate PB streak
  const streak = calculatePBStreak(workouts, exercisesByWorkout);
  if (streakEl) streakEl.textContent = `PB Streak: ${streak} ${streak === 1 ? "tydzień" : streak < 5 ? "tygodnie" : "tygodni"} z rzędu`;
  if (badgeEl) badgeEl.textContent = `Streak: ${streak}w`;

  // Render top 10 PBs
  feedEl.innerHTML = pbHistory
    .slice(0, 10)
    .map(
      (pb) =>
        `<li class="pb-feed-item">
          <div class="pb-feed-name">${escapeHtml(pb.exercise)}</div>
          <div class="pb-feed-meta">
            <strong class="pb-feed-value">${pb.weight} kg</strong>
            <span class="pb-feed-date">${formatDate(pb.date)}</span>
          </div>
          <div class="pb-feed-progress">${pb.progress > 0 ? "+" : ""}${pb.progress.toFixed(1)} kg vs poprzedni</div>
        </li>`
    )
    .join("");
}

function getPBHistory(workouts, exercisesByWorkout) {
  const exerciseHistory = {};

  workouts.forEach((workout) => {
    (exercisesByWorkout[workout.id] || []).forEach((exercise) => {
      const name = exercise.name || "Nieznane";
      const weight = Number(exercise.weight) || 0;

      if (!exerciseHistory[name]) {
        exerciseHistory[name] = [];
      }

      exerciseHistory[name].push({
        weight,
        date: workout.date,
      });
    });
  });

  const pbHistory = [];

  Object.entries(exerciseHistory).forEach(([exercise, history]) => {
    history.sort((a, b) => new Date(a.date) - new Date(b.date));

    let prevPB = 0;
    history.forEach((entry) => {
      if (entry.weight > 0 && entry.weight > prevPB) {
        pbHistory.push({
          exercise,
          weight: entry.weight,
          date: entry.date,
          progress: entry.weight - prevPB,
        });
        prevPB = entry.weight;
      }
    });
  });

  return pbHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function calculatePBStreak(workouts, exercisesByWorkout) {
  const pbHistory = getPBHistory(workouts, exercisesByWorkout);
  const weeks = new Set();

  pbHistory.forEach((entry) => {
    const date = new Date(entry.date);
    if (!Number.isNaN(date.getTime())) {
      weeks.add(getISOWeekKey(date));
    }
  });

  if (!weeks.size) {
    return 0;
  }

  let streak = 0;
  let cursor = startOfISOWeek(new Date());

  for (let i = 0; i < 52; i++) {
    const key = getISOWeekKey(cursor);
    if (weeks.has(key)) {
      streak++;
    } else {
      break;
    }

    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() - 7);
  }

  return streak;
}

function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function renderTrainingHeatmap(workouts) {
  const heatmapEl = document.getElementById("trainingHeatmap");
  const summaryEl = document.getElementById("heatmapSummary");

  if (!heatmapEl) return;

  // Create heatmap of last 12 weeks
  const heatmapData = buildHeatmapData(workouts);

  if (!heatmapData.length) {
    if (summaryEl) summaryEl.textContent = "Brak danych do heatmapy.";
    heatmapEl.innerHTML = "<p>Brak danych</p>";
    return;
  }

  if (summaryEl) {
    const total = heatmapData.reduce((sum, week) => sum + week.count, 0);
    summaryEl.textContent = `${total} treningów w ciągu 12 tygodni`;
  }

  const cellsHtml = heatmapData
    .map(
      (week, index) =>
        `<div class="heatmap-cell heatmap-intensity-${getIntensityLevel(week.count)}" 
              title="${week.week} - ${week.count} treningów"
              data-week="${index}">
          <span class="heatmap-label">${week.dayChar}</span>
        </div>`
    )
    .join("");

  heatmapEl.innerHTML = cellsHtml;
}

function buildHeatmapData(workouts) {
  const days = ["Pn", "Wt", "Śr", "Czw", "Pt", "Sb", "Nd"];
  const slots = [
    { label: "06-10", start: 6, end: 10 },
    { label: "10-14", start: 10, end: 14 },
    { label: "14-18", start: 14, end: 18 },
    { label: "18-22", start: 18, end: 22 },
  ];

  return days.flatMap((day, dayIndex) =>
    slots.map((slot) => {
      const count = workouts.filter((workout) => {
        const date = getWorkoutDateTime(workout);
        const weekdayIndex = (date.getDay() + 6) % 7;
        const hour = date.getHours();
        return weekdayIndex === dayIndex && hour >= slot.start && hour < slot.end;
      }).length;

      return {
        week: `${day} ${slot.label}`,
        count,
        dayChar: `${day} ${slot.label}`,
      };
    })
  );
}

function getIntensityLevel(count) {
  if (count === 0) return "0";
  if (count === 1) return "1";
  if (count === 2) return "2";
  if (count === 3) return "3";
  return "4";
}

function renderBestTrainingWindow(workouts) {
  const windowEl = document.getElementById("bestWindowText");
  const warningEl = document.getElementById("breakWarning");
  const statusEl = document.getElementById("bestWindowStatus");

  if (!windowEl) return;

  // Find best training times
  const timeWindow = findBestTrainingTime(workouts);
  const dayGap = calculateLongestGap(workouts);

  if (timeWindow) {
    windowEl.textContent = `${timeWindow.days} ${timeWindow.timeRange} (${timeWindow.count} treningów)`;
    if (statusEl) statusEl.textContent = "Aktywne";
  } else {
    windowEl.textContent = "Brak wystarczających danych";
    if (statusEl) statusEl.textContent = "-";
  }

  if (warningEl) {
    if (dayGap >= 4) {
      warningEl.classList.remove("hidden");
      warningEl.textContent = `⚠️ Ryzyko wypadnięcia z rytmu: brak treningu przez ${dayGap} dni`;
    } else {
      warningEl.classList.add("hidden");
    }
  }
}

function findBestTrainingTime(workouts) {
  const cells = buildHeatmapData(workouts);
  const best = cells.slice().sort((first, second) => second.count - first.count)[0];
  if (!best || best.count === 0) {
    return null;
  }

  const [day, timeRange] = best.dayChar.split(" ");
  return {
    days: day,
    timeRange,
    count: best.count,
  };
}

function getWorkoutDateTime(workout) {
  if (typeof workout?.createdAt?.toDate === "function") {
    return workout.createdAt.toDate();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(workout?.date || ""))) {
    const fallback = new Date(`${workout.date}T18:00:00`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback;
    }
  }

  const date = new Date(workout?.date || Date.now());
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  return new Date();
}

function calculateLongestGap(workouts) {
  if (!workouts || !workouts.length) return 0;

  const sorted = [...workouts]
    .map((w) => new Date(w.date))
    .sort((a, b) => a - b);

  let maxGap = 0;
  let currentGap = Math.floor((new Date() - sorted[sorted.length - 1]) / (1000 * 60 * 60 * 24));

  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.floor((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
    maxGap = Math.max(maxGap, gap);
  }

  return Math.max(maxGap, currentGap);
}

function renderTopExercisesPro(workouts, exercisesByWorkout) {
  const listEl = document.getElementById("dashboardTopExercisesPro");
  if (!listEl) return;

  const exerciseStats = buildExerciseStats(workouts, exercisesByWorkout);

  if (!exerciseStats.length) {
    listEl.innerHTML = "<li>Brak danych.</li>";
    return;
  }

  listEl.innerHTML = exerciseStats
    .slice(0, 8)
    .map(
      (stat, idx) =>
        `<li class="exercise-pro-item">
          <span class="exercise-rank">#${idx + 1}</span>
          <span class="exercise-name">${escapeHtml(stat.name)}</span>
          <span class="exercise-stats">${stat.maxWeight} kg • ${stat.count}x</span>
          <span class="exercise-trend ${stat.trend > 0 ? "text-success" : stat.trend < 0 ? "text-warning" : ""}">${stat.trend > 0 ? "↑" : stat.trend < 0 ? "↓" : "="} ${Math.abs(stat.trend).toFixed(1)}%</span>
        </li>`
    )
    .join("");
}

function buildExerciseStats(workouts, exercisesByWorkout) {
  const exerciseMap = new Map();

  workouts.forEach((w) => {
    (exercisesByWorkout[w.id] || []).forEach((e) => {
      const name = e.name || "Nieznane";
      if (!exerciseMap.has(name)) {
        exerciseMap.set(name, {
          name,
          maxWeight: 0,
          count: 0,
          weights: [],
        });
      }

      const stat = exerciseMap.get(name);
      stat.count++;
      stat.maxWeight = Math.max(stat.maxWeight, Number(e.weight) || 0);
      stat.weights.push(Number(e.weight) || 0);
    });
  });

  return Array.from(exerciseMap.values())
    .map((stat) => ({
      ...stat,
      trend: calculateWeightTrend30Days(stat.weights),
    }))
    .sort((a, b) => b.maxWeight - a.maxWeight);
}

function calculateWeightTrend30Days(weights) {
  if (weights.length < 2) return 0;

  const half = Math.floor(weights.length / 2);
  const recent = weights.slice(half);
  const older = weights.slice(0, half);

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

  if (olderAvg === 0) return 0;

  return ((recentAvg - olderAvg) / olderAvg) * 100;
}

function renderSmartCoach(workouts, exercisesByWorkout) {
  const priorityEl = document.getElementById("coachPriorityExercises");
  const progressionEl = document.getElementById("coachProgressionSuggestions");
  const warningEl = document.getElementById("coachWarning");
  const warningSection = document.getElementById("coachWarningSection");

  if (!priorityEl) return;

  const topExercises = buildExerciseStats(workouts, exercisesByWorkout).slice(0, 3);

  // Priority exercises
  if (topExercises.length) {
    priorityEl.innerHTML = topExercises
      .map((ex, idx) => `<li>${idx + 1}. ${escapeHtml(ex.name)} (${ex.maxWeight} kg)</li>`)
      .join("");
  } else {
    priorityEl.innerHTML = "<li>Zacznij od podstawowych ćwiczeń</li>";
  }

  // Progression suggestions
  const suggestions = generateProgressionSuggestions(topExercises);
  if (progressionEl) {
    progressionEl.innerHTML = suggestions.map((s) => `<li>${s}</li>`).join("");
  }

  // Overload warning
  const volumeTrend = calculateVolumeProgress(workouts, exercisesByWorkout);
  if (warningSection && warningEl) {
    if (volumeTrend >= 0.8) {
      warningEl.textContent =
        "Objętość wzrosła znacznie - uważaj na przeciążenie i daj sobie czas na regenerację";
      warningSection.classList.remove("hidden");
    } else if (volumeTrend <= 0.35) {
      warningEl.textContent = "Objętość treningów spadła - spróbuj zwiększyć intensywność";
      warningSection.classList.remove("hidden");
    } else {
      warningSection.classList.add("hidden");
    }
  }
}

function generateProgressionSuggestions(topExercises) {
  const suggestions = [];

  topExercises.forEach((ex) => {
    const nextWeight = Math.ceil(ex.maxWeight / 5) * 5 + 2.5;
    suggestions.push(`Spróbuj ${nextWeight} kg w ${ex.name}`);
  });

  if (!suggestions.length) {
    suggestions.push("Brak danych do generowania sugestii");
  }

  return suggestions;
}

// Helper function already exists: calculateVolumeProgress
