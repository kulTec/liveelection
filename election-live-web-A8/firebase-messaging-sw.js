// Shows push notifications when the dashboard tab is closed. Use the same values as js/config.js.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyA8Nck4qrrWE11o6Vn1Y0bKsE-3jkcdHzs',authDomain:'accord-party-live-election.firebaseapp.com',projectId:'accord-party-live-election',appId:'1:649778624843:web:8c9426a9a865cee8f790ce',storageBucket:'accord-party-live-election.firebasestorage.app',messagingSenderId:'649778624843'});
firebase.messaging();   // notification payloads from the server are displayed automatically
