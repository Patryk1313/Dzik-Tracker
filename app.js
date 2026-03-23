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
let dashboardStrengthRange = 12;
let addWorkoutTemplatesCache = [];
let editingTemplateId = null;

document.addEventListener("DOMContentLoaded", () => {
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
      authToggle.textContent = "Zaloguj sie";
      nameGroup.classList.remove("hidden");
      nameInput.required = true;
    } else {
      authSubmit.textContent = "Zaloguj sie";
      authSwitchText.textContent = "Nie masz konta?";
      authToggle.textContent = "Zarejestruj sie";
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
      showError("Email i haslo sa wymagane.", "authError");
      return;
    }

    if (isRegisterMode && !name) {
      showError("Podaj imie do rejestracji.", "authError");
      return;
    }

    toggleLoading(true, "authLoading");

    try {
      if (isRegisterMode) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);

        // Tworzenie dokumentu uzytkownika po rejestracji.
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

  const [userProfile, workouts, allWorkoutsResult] = await Promise.all([
    getUserProfileSafe(user.uid),
    getUserWorkoutsSafe(user.uid),
    getAllWorkoutsSafe(),
  ]);
  const workoutIds = workouts.map((workout) => workout.id);
  const exercisesByWorkout = await getExercisesByWorkoutIds(workoutIds);
  const weeklyGoal = getWeeklyGoal(userProfile);

  renderHomeHeader(user, userProfile);
  renderUserStatus(workouts, weeklyGoal);
  await renderGlobalRanking(allWorkoutsResult.workouts, allWorkoutsResult.hasPermission, user.uid);

  renderLastWorkout(workouts, exercisesByWorkout);
  renderWorkoutHistory(workouts, exercisesByWorkout);

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
  greetingEl.textContent = `Czesc ${displayName} 👋`;
  greetingMetaEl.textContent = "Szybki dostep do Twoich treningow, celu tygodnia i aktywnosci calej spolecznosci.";

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
  const weekProgressTextEl = document.getElementById("weekProgressText");
  const weekProgressBarEl = document.getElementById("weekProgressBar");
  const statusBadgeEl = document.getElementById("statusBadge");
  const statusEmptyEl = document.getElementById("statusEmpty");

  if (
    !lastWorkoutDaysEl ||
    !lastWorkoutDateEl ||
    !streakWeeksEl ||
    !weeklyGoalValueEl ||
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
  weekProgressTextEl.textContent = `${thisWeekCount} / ${weeklyGoal}`;
  weekProgressBarEl.style.width = `${progressPercent}%`;
  streakWeeksEl.textContent = String(streak);

  if (!workouts.length) {
    statusEmptyEl.classList.remove("hidden");
    lastWorkoutDaysEl.textContent = "Brak danych";
    lastWorkoutDateEl.textContent = "Dodaj pierwszy trening";
    statusBadgeEl.textContent = "Brak aktywnosci";
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
  const workoutIds = workouts.map((workout) => workout.id);
  const exercisesByWorkout = await getExercisesByWorkoutIds(workoutIds);

  renderDashboardStats(workouts, exercisesByWorkout);

  toggleLoading(false);
}

async function initAddWorkoutPage(user) {
  const workoutForm = document.getElementById("workoutForm");
  const exercisesContainer = document.getElementById("exercisesContainer");
  const addExerciseBtn = document.getElementById("addExerciseBtn");
  const dateInput = document.getElementById("workoutDate");
  const templateSelect = document.getElementById("workoutTemplate");
  const templateHint = document.getElementById("templateHint");
  const templateBuilderForm = document.getElementById("templateBuilderForm");
  const templateExercisesContainer = document.getElementById("templateExercisesContainer");
  const addTemplateExerciseBtn = document.getElementById("addTemplateExerciseBtn");
  const savedTemplatesList = document.getElementById("savedTemplatesList");
  const templateBuilderState = document.getElementById("templateBuilderState");
  const cancelTemplateEditBtn = document.getElementById("cancelTemplateEditBtn");
  const saveTemplateBtn = document.getElementById("saveTemplateBtn");

  dateInput.value = formatDateForInput(new Date());

  addWorkoutTemplatesCache = await getUserTemplates(user.uid);

  const refreshTemplateSelect = () => {
    if (!templateSelect) {
      return;
    }

    templateSelect.innerHTML = `
      <option value="">-- Brak template (pusta lista) --</option>
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
      savedTemplatesList.innerHTML = "<li>Brak wlasnych template.</li>";
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
              <button class="history-action-btn history-action-btn-danger" data-template-action="delete" data-id="${template.id}" type="button">Usun</button>
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
          showSuccess("Template zostal usuniety.");
        }
      } catch (error) {
        showError(getFriendlyError(error));
      }
    };
  };

  const addExerciseRow = (config = {}) => {
    const {
      name = "",
      defaultWeight = 0,
      sets = 4,
      reps = 8,
      isCustom = false,
    } = config;

    const wrapper = document.createElement("div");
    wrapper.className = "exercise-item";

    const safeName = escapeHtml(name);
    const parsedWeight = Number.isFinite(Number(defaultWeight)) ? Number(defaultWeight) : 0;

    wrapper.innerHTML = `
      <div class="exercise-header">
        <strong>${isCustom ? "Wlasne cwiczenie" : "Cwiczenie z template"}</strong>
        <button type="button" class="link-btn remove-exercise">Usun</button>
      </div>
      <div class="grid grid-2">
        <div class="form-row">
          <label>Nazwa cwiczenia</label>
          <input
            type="text"
            name="exerciseName"
            value="${safeName}"
            placeholder="Np. Przysiad"
            ${isCustom ? "" : "readonly"}
            required
          />
        </div>
        <div class="form-row">
          <label>Serie</label>
          <input type="number" name="sets" min="1" step="1" value="${Number(sets) || 4}" required />
        </div>
        <div class="form-row">
          <label>Powtorzenia</label>
          <input type="number" name="reps" min="1" step="1" value="${Number(reps) || 8}" required />
        </div>
        <div class="form-row">
          <label>Ciezar (kg)</label>
          <input type="number" name="weight" min="0" step="0.5" value="${parsedWeight}" required />
        </div>
      </div>
    `;

    const removeBtn = wrapper.querySelector(".remove-exercise");
    removeBtn.addEventListener("click", () => {
      wrapper.remove();
      if (!exercisesContainer.children.length && templateHint) {
        templateHint.textContent = "Lista cwiczen jest pusta. Wybierz template lub dodaj wlasne cwiczenie.";
      }
    });

    exercisesContainer.appendChild(wrapper);
  };

  const applyTemplate = () => {
    if (!templateSelect) {
      return;
    }

    const templateId = templateSelect.value;
    exercisesContainer.innerHTML = "";

    const template = addWorkoutTemplatesCache.find((item) => item.id === templateId);

    if (!templateId || !template) {
      if (templateHint) {
        templateHint.textContent = "Brak wybranego template - lista cwiczen jest pusta.";
      }
      return;
    }

    if (templateHint) {
      templateHint.textContent = `Zaladowano template: ${template.name}.`;
    }

    template.exercises.forEach((exercise) => addExerciseRow({ ...exercise, isCustom: false }));
  };

  const addTemplateExerciseRow = (data = {}) => {
    if (!templateExercisesContainer) {
      return;
    }

    const row = document.createElement("div");
    row.className = "exercise-item";
    row.innerHTML = `
      <div class="exercise-header">
        <strong>Cwiczenie template</strong>
        <button type="button" class="link-btn remove-template-exercise">Usun</button>
      </div>
      <div class="grid grid-2">
        <div class="form-row">
          <label>Nazwa cwiczenia</label>
          <input type="text" class="template-exercise-name" value="${escapeHtml(data.name || "")}" placeholder="Np. Incline Bench" required />
        </div>
        <div class="form-row">
          <label>Domyslny ciezar (kg)</label>
          <input type="number" class="template-exercise-weight" min="0" step="0.5" value="${Number(data.defaultWeight || 0)}" required />
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
      defaultWeight: Number(row.querySelector(".template-exercise-weight").value),
    }));

    const hasInvalid = exercises.some(
      (exercise) => !exercise.name || Number.isNaN(exercise.defaultWeight)
    );

    if (hasInvalid) {
      throw new Error("Uzupelnij poprawnie wszystkie pola template.");
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
    addExerciseRow({ isCustom: true, sets: 4, reps: 8, defaultWeight: 0 });
    if (templateHint) {
      templateHint.textContent = "Dodano wlasne cwiczenie.";
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
          throw new Error("Podaj nazwe template.");
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
        renderSavedTemplates();

        templateBuilderForm.reset();
        templateExercisesContainer.innerHTML = "";
        addTemplateExerciseRow();
        resetTemplateBuilder(templateBuilderState, cancelTemplateEditBtn, saveTemplateBtn);
        showSuccess(isEditingTemplate ? "Template zostal zaktualizowany." : "Template zostal zapisany.");
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
      const workoutNotes = workoutForm.workoutNotes.value.trim();
      const selectedTemplate = addWorkoutTemplatesCache.find((template) => template.id === templateSelect?.value);
      const workoutTitle = workoutNotes || selectedTemplate?.name || "Trening";
      const exerciseItems = [...exercisesContainer.querySelectorAll(".exercise-item")];

      if (!workoutDate) {
        throw new Error("Wybierz date treningu.");
      }

      if (!exerciseItems.length) {
        throw new Error("Dodaj przynajmniej jedno cwiczenie.");
      }

      const exercises = exerciseItems.map((item) => ({
        name: item.querySelector("input[name='exerciseName']").value.trim(),
        sets: Number(item.querySelector("input[name='sets']").value),
        reps: Number(item.querySelector("input[name='reps']").value),
        weight: Number(item.querySelector("input[name='weight']").value),
      }));

      const hasInvalidExercise = exercises.some(
        (exercise) =>
          !exercise.name ||
          Number.isNaN(exercise.sets) ||
          Number.isNaN(exercise.reps) ||
          Number.isNaN(exercise.weight)
      );

      if (hasInvalidExercise) {
        throw new Error("Uzupelnij poprawnie wszystkie pola cwiczen.");
      }

      // Najpierw zapis treningu, potem cwiczen z workoutId.
      const workoutRef = await addDoc(collection(db, "workouts"), {
        userId: user.uid,
        title: workoutTitle,
        date: workoutDate,
        notes: workoutNotes,
        createdAt: serverTimestamp(),
      });

      await Promise.all(
        exercises.map((exercise) =>
          addDoc(collection(db, "exercises"), {
            workoutId: workoutRef.id,
            name: exercise.name,
            sets: exercise.sets,
            reps: exercise.reps,
            weight: exercise.weight,
          })
        )
      );

      showSuccess("Trening zostal zapisany.");
      workoutForm.reset();
      dateInput.value = formatDateForInput(new Date());
      if (templateSelect) {
        templateSelect.value = "";
      }
      exercisesContainer.innerHTML = "";
      if (templateHint) {
        templateHint.textContent = "Brak wybranego template - lista cwiczen jest pusta.";
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
    templateBuilderState.textContent = `Edytujesz template: ${template.name}`;
  }

  if (cancelTemplateEditBtn) {
    cancelTemplateEditBtn.classList.remove("hidden");
  }

  if (saveTemplateBtn) {
    saveTemplateBtn.textContent = "Zapisz zmiany";
  }
}

function addTemplateExerciseRowForEditor(container, data = {}) {
  const row = document.createElement("div");
  row.className = "exercise-item";
  row.innerHTML = `
    <div class="exercise-header">
      <strong>Cwiczenie template</strong>
      <button type="button" class="link-btn remove-template-exercise">Usun</button>
    </div>
    <div class="grid grid-2">
      <div class="form-row">
        <label>Nazwa cwiczenia</label>
        <input type="text" class="template-exercise-name" value="${escapeHtml(data.name || "")}" placeholder="Np. Incline Bench" required />
      </div>
      <div class="form-row">
        <label>Domyslny ciezar (kg)</label>
        <input type="number" class="template-exercise-weight" min="0" step="0.5" value="${Number(data.defaultWeight || 0)}" required />
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
    templateBuilderState.textContent = "Tworzysz nowy template.";
  }

  if (cancelTemplateEditBtn) {
    cancelTemplateEditBtn.classList.add("hidden");
  }

  if (saveTemplateBtn) {
    saveTemplateBtn.textContent = "Zapisz template";
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
    throw new Error("Nie mozesz usunac cudzego template.");
  }

  const shouldDelete = window.confirm("Czy na pewno chcesz usunac ten template?");
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
  const profileEmail = document.getElementById("profileEmail");
  const profileCreated = document.getElementById("profileCreated");
  const profilePhoto = document.getElementById("profilePhoto");
  const profileAvatarFallback = document.getElementById("profileAvatarFallback");
  const profileDisplayName = document.getElementById("profileDisplayName");
  const profileDisplayEmail = document.getElementById("profileDisplayEmail");

  const nameValue = profileData.name || "-";
  const emailValue = profileData.email || user.email || "-";
  const createdValue = formatTimestamp(profileData.createdAt) || "-";
  const birthDateValue = profileData.birthDate
    ? formatDate(profileData.birthDate)
    : Number.isFinite(Number(profileData.birthYear))
      ? String(profileData.birthYear)
      : "-";
  const photoUrl = typeof profileData.photoURL === "string" ? profileData.photoURL : "";

  profileName.textContent = nameValue;
  profileBirthDate.textContent = birthDateValue;
  profileEmail.textContent = emailValue;
  profileCreated.textContent = createdValue;
  profileDisplayName.textContent = nameValue;
  profileDisplayEmail.textContent = emailValue;
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
      showError("Zdjecie jest za duze. Maksymalny rozmiar to 4 MB.", "pageError");
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
      showSuccess("Zdjecie profilowe zostalo usuniete.");
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

      if (!name) {
        throw new Error("Imie jest wymagane.");
      }

      let birthYear = null;
      if (birthDate) {
        birthYear = Number(birthDate.slice(0, 4));
      }

      const payload = {
        name,
        birthDate: birthDate || "",
        birthYear,
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
      showSuccess("Profil zostal zaktualizowany.");
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

  workoutsPageCache = await getUserWorkoutsSafe(user.uid);
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
    list.innerHTML = "<li>Brak treningow. Dodaj pierwszy trening.</li>";
    return;
  }

  list.innerHTML = workoutsPageCache
    .map((workout) => {
      const exercises = workoutsExercisesCache[workout.id] || [];
      const workoutTitle = workout.title || workout.notes || "Trening";
      const exercisesSummary = exercises.length
        ? exercises
            .map(
              (exercise) =>
                `${escapeHtml(exercise.name)} (${exercise.sets}x${exercise.reps} @ ${exercise.weight}kg)`
            )
            .join(" | ")
        : "Brak cwiczen";

      return `
        <li class="history-entry workouts-page-entry">
          <strong class="history-date">${formatDate(workout.date)}</strong>
          <strong class="history-title">${escapeHtml(workoutTitle)}</strong>
          <span class="text-muted">${workout.notes ? escapeHtml(workout.notes) : "Bez notatki"}</span>
          <span class="history-notes text-muted">${exercisesSummary}</span>
          <div class="history-actions">
            <button class="history-action-btn" data-workout-action="edit" data-id="${workout.id}" type="button">Edytuj</button>
            <button class="history-action-btn history-action-btn-danger" data-workout-action="delete" data-id="${workout.id}" type="button">Usun</button>
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
      const date = form.editWorkoutDate.value.trim();
      const notes = form.editWorkoutNotes.value.trim();
      const exercises = collectWorkoutEditorExercises();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Niepoprawny format daty. Uzyj YYYY-MM-DD.");
      }

      if (!exercises.length) {
        throw new Error("Dodaj przynajmniej jedno cwiczenie.");
      }

      await updateDoc(doc(db, "workouts", editingWorkoutId), {
        date,
        notes,
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
          })
        )
      );

      showSuccess("Trening zostal zaktualizowany.");
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
  form.editWorkoutDate.value = workout.date || "";
  form.editWorkoutNotes.value = workout.notes || "";

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

  const row = document.createElement("div");
  row.className = "exercise-item";
  row.innerHTML = `
    <div class="exercise-header">
      <strong>Cwiczenie</strong>
      <button type="button" class="link-btn workout-editor-remove">Usun</button>
    </div>
    <div class="grid grid-2">
      <div class="form-row">
        <label>Nazwa cwiczenia</label>
        <input type="text" class="edit-ex-name" value="${escapeHtml(data.name || "")}" required />
      </div>
      <div class="form-row">
        <label>Serie</label>
        <input type="number" class="edit-ex-sets" min="1" step="1" value="${Number(data.sets || 1)}" required />
      </div>
      <div class="form-row">
        <label>Powtorzenia</label>
        <input type="number" class="edit-ex-reps" min="1" step="1" value="${Number(data.reps || 1)}" required />
      </div>
      <div class="form-row">
        <label>Ciezar (kg)</label>
        <input type="number" class="edit-ex-weight" min="0" step="0.5" value="${Number(data.weight || 0)}" required />
      </div>
    </div>
  `;

  row.querySelector(".workout-editor-remove").onclick = () => {
    row.remove();
    if (!container.children.length) {
      addWorkoutEditorExerciseRow();
    }
  };

  container.appendChild(row);
}

function collectWorkoutEditorExercises() {
  const rows = [...document.querySelectorAll("#editExercisesContainer .exercise-item")];
  const exercises = rows.map((row) => ({
    name: row.querySelector(".edit-ex-name").value.trim(),
    sets: Number(row.querySelector(".edit-ex-sets").value),
    reps: Number(row.querySelector(".edit-ex-reps").value),
    weight: Number(row.querySelector(".edit-ex-weight").value),
  }));

  const hasInvalid = exercises.some(
    (exercise) =>
      !exercise.name ||
      Number.isNaN(exercise.sets) ||
      Number.isNaN(exercise.reps) ||
      Number.isNaN(exercise.weight)
  );

  if (hasInvalid) {
    throw new Error("Uzupelnij poprawnie wszystkie pola cwiczen.");
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
    throw new Error("Nie mozesz usunac cudzego treningu.");
  }

  const shouldDelete = window.confirm("Czy na pewno chcesz usunac ten trening?");
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

    showSuccess("Trening zostal usuniety.");
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

async function getExercisesByWorkoutIds(workoutIds) {
  if (!workoutIds.length) {
    return {};
  }

  // Firestore nie wspiera prostego join, dlatego pobieramy cwiczenia per trening.
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
      <p class="last-workout-notes text-muted">${
        latest.notes ? escapeHtml(latest.notes) : "Brak notatek"
      }</p>
      <p class="text-muted">Brak cwiczen w tym treningu.</p>
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
    <p class="last-workout-notes text-muted">${
      latest.notes ? escapeHtml(latest.notes) : "Brak notatek"
    }</p>
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
    historyList.innerHTML = "<li>Brak historii treningow.</li>";
    if (historyToggleBtn) {
      historyToggleBtn.classList.add("hidden");
    }
    return;
  }

  const visibleItems = homeHistoryExpanded ? workouts : workouts.slice(0, 6);
  const items = visibleItems.map((workout) => {
    const title = workout.title
      ? escapeHtml(workout.title)
      : workout.notes
        ? escapeHtml(workout.notes)
        : "Trening";

    return `
      <li class="history-entry">
        <strong class="history-title">${title}</strong>
      </li>
    `;
  });

  historyList.innerHTML = items.join("");

  if (historyToggleBtn) {
    if (workouts.length > 6) {
      historyToggleBtn.classList.remove("hidden");
      historyToggleBtn.textContent = homeHistoryExpanded ? "Pokaz mniej" : "Pokaz wiecej";
      historyToggleBtn.onclick = () => {
        homeHistoryExpanded = !homeHistoryExpanded;
        renderWorkoutHistory(workouts, exercisesByWorkout);
      };
    } else {
      historyToggleBtn.classList.add("hidden");
    }
  }
}

async function renderGlobalRanking(workouts, hasPermission = true, currentUserId = "") {
  const rankingSummaryEl = document.getElementById("rankingSummary");
  const rankingEmptyEl = document.getElementById("rankingEmpty");
  const rankingListEl = document.getElementById("rankingList");

  if (!rankingSummaryEl || !rankingEmptyEl || !rankingListEl) {
    return;
  }

  if (!hasPermission) {
    rankingSummaryEl.textContent = "Brak uprawnien do globalnego rankingu. Zaktualizuj reguly Firestore.";
    rankingEmptyEl.textContent = "Ranking jest ukryty do czasu wlaczenia odczytu workouts dla zalogowanych uzytkownikow.";
    rankingEmptyEl.classList.remove("hidden");
    rankingListEl.innerHTML = "<li>Brak danych rankingu.</li>";
    return;
  }

  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 6);

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

  const ranking = [...countsByUser.entries()]
    .map(([userId, total]) => ({ userId, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const profiles = await Promise.all(
    ranking.map(async (entry) => ({
      userId: entry.userId,
      profile: await getUserProfileSafe(entry.userId),
    }))
  );
  const profileById = new Map(profiles.map((entry) => [entry.userId, entry.profile]));

  const totalWorkouts = recentWorkouts.length;
  rankingSummaryEl.textContent = `${ranking.length} aktywnych osob, ${totalWorkouts} treningow lacznie w 7 dni`;

  if (!ranking.length) {
    rankingEmptyEl.classList.remove("hidden");
    rankingListEl.innerHTML = "<li>Brak aktywnosci w rankingu.</li>";
    return;
  }

  rankingEmptyEl.classList.add("hidden");
  const bestValue = ranking[0].total || 1;

  rankingListEl.innerHTML = ranking
    .map((entry, index) => {
      const place = index + 1;
      const isCurrentUser = currentUserId && entry.userId === currentUserId;
      const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : "#";
      const profile = profileById.get(entry.userId) || null;
      const label = isCurrentUser
        ? "Ty"
        : profile?.name || `Uzytkownik ${entry.userId.slice(0, 4).toUpperCase()}`;
      const avatar = profile?.photoURL || "";
      const ratio = Math.max(12, (entry.total / bestValue) * 100);

      return `
        <li class="ranking-item${isCurrentUser ? " ranking-item-me" : ""}">
          <div class="ranking-head">
            <span class="ranking-place">${medal} ${place}</span>
            <span class="ranking-user-wrap">
              ${avatar
                ? `<img src="${escapeHtml(avatar)}" alt="Avatar" class="ranking-avatar" />`
                : `<span class="ranking-avatar ranking-avatar-fallback">${getInitial(label)}</span>`}
              <span class="ranking-user">${escapeHtml(label)}</span>
            </span>
            <span class="ranking-score">${entry.total}</span>
          </div>
          <div class="ranking-track">
            <div class="ranking-fill" style="width: ${ratio}%"></div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderPB(workouts, exercisesByWorkout) {
  const pbList = document.getElementById("pbList");
  if (!pbList) {
    return;
  }

  if (!workouts.length) {
    pbList.innerHTML = "<li>Brak rekordow. Dodaj pierwszy trening.</li>";
    return;
  }

  const pbMap = new Map();

  workouts.forEach((workout) => {
    const exercises = exercisesByWorkout[workout.id] || [];

    exercises.forEach((exercise) => {
      const name = exercise.name || "Nieznane";
      const weight = Number(exercise.weight) || 0;
      const current = pbMap.get(name) || 0;

      if (weight > current) {
        pbMap.set(name, weight);
      }
    });
  });

  if (!pbMap.size) {
    pbList.innerHTML = "<li>Brak rekordow. Dodaj cwiczenia z ciezarem.</li>";
    return;
  }

  const rows = [...pbMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "pl"))
    .map(
      ([name, weight]) =>
        `<li class="pb-item"><span>${escapeHtml(name)}</span><strong class="pb-weight">${weight} kg</strong></li>`
    );

  pbList.innerHTML = rows.join("");
}

function renderDashboardStats(workouts, exercisesByWorkout) {
  renderDashboardOverview(workouts, exercisesByWorkout);
  setupDashboardRangeToggle(workouts, exercisesByWorkout);
  renderDashboardStrengthChart(workouts, exercisesByWorkout, dashboardStrengthRange);
  renderDashboardRecords(workouts, exercisesByWorkout);
  renderDashboardFrequency(workouts);
  renderDashboardTopExercises(workouts, exercisesByWorkout);
  renderDashboardHeatmap(workouts, exercisesByWorkout);
}

function setupDashboardRangeToggle(workouts, exercisesByWorkout) {
  const toggle = document.getElementById("strengthRangeToggle");
  if (!toggle) {
    return;
  }

  const buttons = [...toggle.querySelectorAll(".range-btn[data-strength-range]")];
  buttons.forEach((button) => {
    const value = Number(button.dataset.strengthRange);
    button.classList.toggle("active", value === dashboardStrengthRange);

    button.onclick = () => {
      dashboardStrengthRange = value;
      buttons.forEach((item) => {
        const itemValue = Number(item.dataset.strengthRange);
        item.classList.toggle("active", itemValue === dashboardStrengthRange);
      });

      renderDashboardStrengthChart(workouts, exercisesByWorkout, dashboardStrengthRange);
    };
  });
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

function renderDashboardStrengthChart(workouts, exercisesByWorkout, range = 12) {
  const canvas = document.getElementById("strengthChart");
  const summaryEl = document.getElementById("strengthSummary");

  if (!canvas || !summaryEl) {
    return;
  }

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
    .filter((point) => point.value > 0)
    .slice(-range);

  if (!series.length) {
    summaryEl.textContent = "Brak danych ciezaru do wykresu progresu silowego.";
    clearCanvas(canvas);
    return;
  }

  const start = series[0].value;
  const end = series[series.length - 1].value;
  const delta = end - start;
  const sign = delta > 0 ? "+" : "";
  summaryEl.textContent = `Top ciezar, zakres ${range} treningow, zmiana ${sign}${delta.toFixed(1)} kg`;

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

  const background = context.createLinearGradient(0, padding.top, 0, chartBottom);
  background.addColorStop(0, "rgba(20, 22, 25, 0.98)");
  background.addColorStop(1, "rgba(12, 14, 17, 0.98)");
  context.fillStyle = background;
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
    context.fillText(Math.round(value).toLocaleString("en-US"), 8, y);
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

  const fillGradient = context.createLinearGradient(0, padding.top, 0, chartBottom);
  fillGradient.addColorStop(0, "rgba(255, 129, 55, 0.72)");
  fillGradient.addColorStop(0.55, "rgba(255, 129, 55, 0.34)");
  fillGradient.addColorStop(1, "rgba(255, 129, 55, 0.08)");
  context.fillStyle = fillGradient;
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

    const label = Math.round(point.value).toLocaleString("en-US");
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

  const pbMap = new Map();
  workouts.forEach((workout) => {
    (exercisesByWorkout[workout.id] || []).forEach((exercise) => {
      const name = exercise.name || "Nieznane";
      const weight = Number(exercise.weight) || 0;
      if (weight > (pbMap.get(name) || 0)) {
        pbMap.set(name, weight);
      }
    });
  });

  if (!pbMap.size) {
    recordsList.innerHTML = "<li>Brak rekordow.</li>";
    return;
  }

  recordsList.innerHTML = [...pbMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(
      ([name, weight]) =>
        `<li class="pb-item"><span>${escapeHtml(name)}</span><strong class="pb-weight">${weight} kg</strong></li>`
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
  summaryEl.textContent = `Laczna objetosc: ${Math.round(totalVolume).toLocaleString("pl-PL")} kg (sets x reps x ciezar)`;

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
    return "Haslo jest za slabe (minimum 6 znakow).";
  }

  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Niepoprawny email lub haslo.";
  }

  if (code.includes("auth/user-not-found")) {
    return "Uzytkownik nie istnieje.";
  }

  if (code.includes("permission-denied")) {
    return "Brak uprawnien do odczytu danych. Sprawdz reguly Firestore.";
  }

  if (error.message) {
    return error.message;
  }

  return "Wystapil blad. Sprobuj ponownie.";
}
