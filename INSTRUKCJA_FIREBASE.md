# Firebase - instrukcja konfiguracji bazy dla Gym Tracker

## 1. Utworz projekt Firebase

1. Wejdz na: https://console.firebase.google.com/
2. Kliknij Create a project.
3. Nazwij projekt, np. Gym Tracker.
4. Wylacz Google Analytics (opcjonalnie) i zakoncz tworzenie.

## 2. Dodaj aplikacje web

1. W projekcie kliknij ikonke Web (</>).
2. Podaj nazwe aplikacji, np. gym-tracker-web.
3. Kliknij Register app.
4. Skopiuj obiekt konfiguracji Firebase i wklej do pliku [firebase.js](firebase.js) w miejsce:

   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_AUTH_DOMAIN",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_STORAGE_BUCKET",
     messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
     appId: "YOUR_APP_ID",
   };

## 3. Wlacz logowanie email/haslo (Authentication)

1. Wejdz w Authentication.
2. Kliknij Get started.
3. Zakladka Sign-in method.
4. Wlacz Email/Password.
5. Zapisz.

## 4. Utworz baze Firestore

1. Wejdz w Firestore Database.
2. Kliknij Create database.
3. Wybierz Start in production mode.
4. Wybierz region (najlepiej europejski, np. europe-central2).
5. Kliknij Enable.

## 5. Ustaw reguly bezpieczenstwa Firestore

W Firestore -> Rules wklej:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }

    match /workouts/{workoutId} {
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;

      allow read: if request.auth != null;

      allow update, delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }

    match /exercises/{exerciseId} {
      allow read, write: if request.auth != null;
    }

    match /templates/{templateId} {
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;

      allow read: if request.auth != null
        && resource.data.userId == request.auth.uid;

      allow update, delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}

Nastepnie kliknij Publish.

Uwaga:
- Te reguly sa wystarczajace na start i sa potrzebne, jesli Home ma pokazywac globalna aktywnosc wszystkich uzytkownikow.
- Dla exercises w produkcji warto dodac dodatkowe walidacje powiazania z workoutId i wlascicielem treningu.

## 6. Struktura danych w Firestore

Aplikacja zapisuje dane do 4 kolekcji:

1. users
- id: uid z Firebase Auth (ID dokumentu)
- email: string
- name: string
- createdAt: timestamp

2. workouts
- id: automatyczne ID dokumentu
- userId: uid uzytkownika
- date: string (YYYY-MM-DD)
- notes: string
- createdAt: timestamp

3. exercises
- id: automatyczne ID dokumentu
- workoutId: ID treningu
- name: string
- sets: number
- reps: number
- weight: number

4. templates
- id: automatyczne ID dokumentu
- userId: uid uzytkownika
- name: string
- exercises: array
- exercises[].name: string
- exercises[].defaultWeight: number
- createdAt: timestamp
- updatedAt: timestamp

## 7. Test polaczenia aplikacji

1. Uruchom aplikacje przez lokalny serwer HTTP (nie otwieraj plikow bezposrednio z dysku).
2. Wejdz na [login.html](login.html).
3. Zarejestruj nowe konto.
4. Sprawdz w Firebase:
- Authentication -> Users (czy uzytkownik sie pojawil)
- Firestore -> users (czy dokument uzytkownika zostal utworzony)
5. Dodaj trening na stronie Dodaj trening.
6. Zapisz wlasny template na stronie Dodaj trening.
7. Sprawdz kolekcje workouts, exercises i templates.

## 8. Najczestsze problemy

1. Blad auth/invalid-api-key
- Masz zle wklejone dane w [firebase.js](firebase.js).

2. Permission denied / Missing or insufficient permissions
- Reguly Firestore sa zbyt restrykcyjne albo nieopublikowane.

3. Strony nie dzialaja po dwukliku pliku
- Trzeba uruchomic lokalny serwer, np. rozszerzenie Live Server albo prosty serwer statyczny.

## 9. Co zrobic po konfiguracji

1. Ustaw poprawne domeny w Authentication -> Settings -> Authorized domains (jesli potrzebne).
2. Rozszerz reguly Firestore dla exercises, aby sprawdzac wlasciciela treningu.
3. Dodaj kopie zapasowe i monitoring bledu w Firebase Console.
