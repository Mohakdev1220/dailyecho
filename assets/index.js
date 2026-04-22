
      // For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDJANDEn9IdMFNEvKClOofHTmX64IsSyqw",
  authDomain: "dailymemo-92398.firebaseapp.com",
  projectId: "dailymemo-92398",
  storageBucket: "dailymemo-92398.firebasestorage.app",
  messagingSenderId: "707078957755",
  appId: "1:707078957755:web:5027f3cac6a4590059579e",
  measurementId: "G-21EY99C4ZK"
};
        };
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const db = firebase.firestore();

        // --- AUTHENTICATION ---
        function signInWithGoogle() {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider);
        }

        function signInWithPhone() {
            const number = document.getElementById('phoneNum').value;
            const appVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container');
            auth.signInWithPhoneNumber(number, appVerifier).then(result => {
                const code = prompt("Enter OTP:");
                return result.confirm(code);
            });
        }

        auth.onAuthStateChanged(user => {
            if (user) {
                document.getElementById('auth-screen').style.display = 'none';
                loadData();
            } else {
                document.getElementById('auth-screen').style.display = 'flex';
            }
        });

        // --- CORE DATA (FIRESTORE) ---
        let diaryData = [];
        const grads = ['linear-gradient(45deg, #f093fb, #f5576c)', 'linear-gradient(45deg, #5ee7df, #b490ca)', 'linear-gradient(45deg, #667eea, #764ba2)'];

        async function loadData() {
            const snapshot = await db.collection('diaries').doc(auth.currentUser.uid).collection('entries').orderBy('timestamp', 'desc').get();
            diaryData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            render();
        }

        async function handleSave() {
            const t = document.getElementById('title').value;
            const d = document.getElementById('date').value;
            const ds = document.getElementById('desc').value;
            const id = document.getElementById('editId').value;

            const entry = {
                title: t, date: d, desc: ds,
                color: grads[Math.floor(Math.random()*grads.length)],
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            };

            if(id) {
                await db.collection('diaries').doc(auth.currentUser.uid).collection('entries').doc(id).update(entry);
            } else {
                await db.collection('diaries').doc(auth.currentUser.uid).collection('entries').add(entry);
            }
            loadData();
            hideModal();
        }

        // --- DANGER ACTIONS & SETTINGS ---
        function toggleSettings() {
            document.getElementById('settings-menu').classList.toggle('settings-open');
        }

        async function dangerAction(type) {
            const user = auth.currentUser;
            // Verification check
            if (!user.emailVerified && user.providerData[0].providerId === 'google.com') {
                return alert("Please verify your Gmail first to perform this action.");
            }

            const confirm = prompt("This is permanent. Type 'CONFIRM' to proceed:");
            if (confirm !== "CONFIRM") return;

            if (type === 'clear') {
                const entries = await db.collection('diaries').doc(user.uid).collection('entries').get();
                entries.forEach(doc => doc.ref.delete());
                loadData();
            } else if (type === 'deleteAcc') {
                user.delete().then(() => location.reload());
            }
        }

        function render() {
            const grid = document.getElementById('grid');
            grid.innerHTML = diaryData.map(item => `
                <div class="card">
                    <div class="card-header" style="background: ${item.color}">${item.title}</div>
                    <div class="card-body">
                        <div style="color:var(--accent); font-size:0.8rem"><b>${item.date}</b></div>
                        <p style="color:var(--sub)">${item.desc}</p>
                    </div>
                </div>
            `).join('');
        }

        function toggleTheme() {
            const b = document.body;
            const isL = b.getAttribute('data-theme') === 'light';
            b.setAttribute('data-theme', isL ? 'dark' : 'light');
            document.getElementById('tBtn').innerText = isL ? "Light Mode" : "Dark Mode";
        }

        function showModal() { document.getElementById('overlay').style.display = 'flex'; }
        function hideModal() { document.getElementById('overlay').style.display = 'none'; }
    
