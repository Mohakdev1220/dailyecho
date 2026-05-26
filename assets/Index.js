
        let currentTab = 'targets';
        const gradients = [
            'linear-gradient(135deg, #6366f1, #a855f7)',
            'linear-gradient(135deg, #3b82f6, #2dd4bf)',
            'linear-gradient(135deg, #f43f5e, #fb923c)',
            'linear-gradient(135deg, #10b981, #3b82f6)',
            'linear-gradient(135deg, #f59e0b, #ef4444)',
            'linear-gradient(135deg, #8b5cf6, #ec4899)'
        ];

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            updateDateTime();
            setInterval(updateDateTime, 60000); // Update every minute
            loadWeather();
            setTodayDate();
            loadData();
            updateStorageInfo();
        });

        // Date & Time
        function updateDateTime() {
            const now = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            document.getElementById('currentDate').textContent = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            document.getElementById('currentDay').textContent = now.toLocaleDateString('en-US', { weekday: 'long' });
        }

        function setTodayDate() {
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('date').value = today;
        }

        // Weather with Geolocation
        async function loadWeather() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        const lat = position.coords.latitude;
                        const lon = position.coords.longitude;
                        await fetchWeather(lat, lon);
                    },
                    (error) => {
                        console.log('Location access denied:', error);
                        document.getElementById('weatherLocation').textContent = '📍 Location access denied';
                        loadDefaultWeather();
                    }
                );
            } else {
                document.getElementById('weatherLocation').textContent = '📍 Geolocation not supported';
                loadDefaultWeather();
            }
        }

        async function fetchWeather(lat, lon) {
            try {
                // Using Open-Meteo API (free, no API key required)
                const weatherResponse = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode&timezone=auto`
                );
                const weatherData = await weatherResponse.json();

                // Get location name using reverse geocoding
                const geoResponse = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
                );
                const geoData = await geoResponse.json();

                const temp = Math.round(weatherData.current.temperature_2m);
                const weatherCode = weatherData.current.weathercode;
                const weatherDesc = getWeatherDescription(weatherCode);
                
                const city = geoData.address.city || geoData.address.town || geoData.address.village || geoData.address.state || 'Your Location';

                document.getElementById('weatherTemp').textContent = temp + '°C';
                document.getElementById('weatherDesc').textContent = weatherDesc;
                document.getElementById('weatherLocation').textContent = `📍 ${city}`;
            } catch (error) {
                console.error('Weather fetch error:', error);
                loadDefaultWeather();
            }
        }

        function getWeatherDescription(code) {
            const weatherCodes = {
                0: 'Clear Sky',
                1: 'Mainly Clear',
                2: 'Partly Cloudy',
                3: 'Overcast',
                45: 'Foggy',
                48: 'Foggy',
                51: 'Light Drizzle',
                53: 'Drizzle',
                55: 'Heavy Drizzle',
                61: 'Light Rain',
                63: 'Rain',
                65: 'Heavy Rain',
                71: 'Light Snow',
                73: 'Snow',
                75: 'Heavy Snow',
                77: 'Snow Grains',
                80: 'Light Showers',
                81: 'Showers',
                82: 'Heavy Showers',
                85: 'Light Snow Showers',
                86: 'Snow Showers',
                95: 'Thunderstorm',
                96: 'Thunderstorm with Hail',
                99: 'Thunderstorm with Hail'
            };
            return weatherCodes[code] || 'Unknown';
        }

        function loadDefaultWeather() {
            document.getElementById('weatherTemp').textContent = '25°C';
            document.getElementById('weatherDesc').textContent = 'Clear Sky';
            if (!document.getElementById('weatherLocation').textContent.includes('📍')) {
                document.getElementById('weatherLocation').textContent = '📍 Default Location';
            }
        }

        // Tab Switching
        function switchTab(tab) {
            currentTab = tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            loadData();
        }

        // Modal Management
        function toggleSheet(id) {
            const el = document.getElementById(id);
            const modal = el.querySelector('.modal');
            if (el.style.display === 'flex') {
                modal.classList.remove('active');
                setTimeout(() => el.style.display = 'none', 400);
            } else {
                el.style.display = 'flex';
                setTimeout(() => modal.classList.add('active'), 10);
            }
        }

        function openAddSheet() {
            document.getElementById('entryType').value = currentTab === 'targets' ? 'target' : currentTab === 'moments' ? 'moment' : 'note';
            setTodayDate();
            toggleSheet('addSheet');
        }

        // Save Entry
        function saveEntry() {
            const title = document.getElementById('title').value;
            const date = document.getElementById('date').value;
            const desc = document.getElementById('desc').value;
            const type = document.getElementById('entryType').value;

            if (!title || !date || !desc) {
                alert('Please fill all fields!');
                return;
            }

            const entry = {
                id: Date.now(),
                title,
                date,
                desc,
                type,
                color: gradients[Math.floor(Math.random() * gradients.length)],
                created: new Date().toISOString(),
                completed: false,
                progress: 0
            };

            // Get existing data
            const data = JSON.parse(localStorage.getItem('echoData') || '[]');
            data.push(entry);
            localStorage.setItem('echoData', JSON.stringify(data));

            // Clear form
            document.getElementById('title').value = '';
            document.getElementById('desc').value = '';
            
            toggleSheet('addSheet');
            loadData();
            updateStorageInfo();
        }

        // Load Data
        function loadData() {
            const data = JSON.parse(localStorage.getItem('echoData') || '[]');
            const filtered = data.filter(item => item.type === currentTab.slice(0, -1));
            
            const grid = document.getElementById('mainGrid');
            
            if (filtered.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: #64748b;">
                        <div style="font-size: 4rem; margin-bottom: 20px;">📝</div>
                        <h3>No entries yet</h3>
                        <p>Click the + button to add your first ${currentTab.slice(0, -1)}</p>
                    </div>
                `;
                return;
            }

            grid.innerHTML = filtered.sort((a, b) => new Date(b.created) - new Date(a.created)).map(item => {
                const badge = item.type === 'target' ? '🎯' : item.type === 'moment' ? '✨' : '📝';
                
                if (item.type === 'target') {
                    return `
                        <div class="card">
                            <button class="delete-btn" onclick="deleteEntry(${item.id})">×</button>
                            <div class="card-header" style="background: ${item.color}">
                                <span class="card-badge">${badge}</span>
                                ${item.title}
                            </div>
                            <div class="card-body">
                                <span class="card-date">${item.date}</span>
                                <p class="card-desc">${item.desc}</p>
                                ${item.completed ? '<p style="color: #10b981; font-weight: 700; margin-top: 10px;">✓ Completed</p>' : `
                                    <div class="target-actions">
                                        <button class="btn-small btn-complete" onclick="completeTarget(${item.id})">✓ Complete</button>
                                    </div>
                                `}
                            </div>
                        </div>
                    `;
                } else {
                    return `
                        <div class="card">
                            <button class="delete-btn" onclick="deleteEntry(${item.id})">×</button>
                            <div class="card-header" style="background: ${item.color}">
                                <span class="card-badge">${badge}</span>
                                ${item.title}
                            </div>
                            <div class="card-body">
                                <span class="card-date">${item.date}</span>
                                <p class="card-desc">${item.desc}</p>
                            </div>
                        </div>
                    `;
                }
            }).join('');
        }

        // Complete Target
        function completeTarget(id) {
            const data = JSON.parse(localStorage.getItem('echoData') || '[]');
            const entry = data.find(item => item.id === id);
            if (entry) {
                entry.completed = true;
                localStorage.setItem('echoData', JSON.stringify(data));
                loadData();
            }
        }

        // Delete Entry
        function deleteEntry(id) {
            if (!confirm('Delete this entry?')) return;
            
            const data = JSON.parse(localStorage.getItem('echoData') || '[]');
            const filtered = data.filter(item => item.id !== id);
            localStorage.setItem('echoData', JSON.stringify(filtered));
            loadData();
            updateStorageInfo();
        }

        // Storage Info
        function updateStorageInfo() {
            const data = JSON.parse(localStorage.getItem('echoData') || '[]');
            document.getElementById('storageInfo').textContent = `${data.length} entries`;
        }

        // Export Data
        function exportData() {
            const data = localStorage.getItem('echoData') || '[]';
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `echo-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            alert('Data exported successfully!');
        }
    
