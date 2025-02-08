let map;
let routingControl = null;
let currentLocationMarker = null;

// Initialize map when document is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeMap();
    setupEventListeners();
    // Hide traffic info panel initially
    document.getElementById('trafficInfo').style.display = 'none';
});

function initializeMap() {
    map = L.map('map').setView([16.2398, 80.0968], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
}

function setupEventListeners() {
    document.getElementById('getCurrentLocation').addEventListener('click', getCurrentLocation);
    document.getElementById('findRouteBtn').addEventListener('click', findRoute);
    document.getElementById('getTrafficBtn').addEventListener('click', getTrafficInfo);
}

async function getCurrentLocation() {
    const locationButton = document.getElementById('getCurrentLocation');
    const originalButtonText = locationButton.innerHTML;
    locationButton.innerHTML = '⌛';
    locationButton.disabled = true;

    // Enhanced geolocation options for better accuracy
    const options = {
        enableHighAccuracy: true,    // Request best possible accuracy
        timeout: 15000,              // Increased timeout for better accuracy
        maximumAge: 0,               // Always get fresh position
        desiredAccuracy: 10          // Desired accuracy in meters
    };

    try {
        // Watch position instead of getting it once
        const position = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is not supported by your browser'));
                return;
            }

            let watchId;
            let bestPosition = null;
            let bestAccuracy = Infinity;

            // Watch position with timeout
            watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const accuracy = position.coords.accuracy;
                    
                    // Update if we get a more accurate position
                    if (accuracy < bestAccuracy) {
                        bestAccuracy = accuracy;
                        bestPosition = position;

                        // If accuracy is good enough, resolve immediately
                        if (accuracy <= options.desiredAccuracy) {
                            navigator.geolocation.clearWatch(watchId);
                            resolve(bestPosition);
                        }
                    }
                },
                (error) => {
                    navigator.geolocation.clearWatch(watchId);
                    reject(error);
                },
                options
            );

            // Timeout after specified duration
            setTimeout(() => {
                navigator.geolocation.clearWatch(watchId);
                if (bestPosition) {
                    resolve(bestPosition); // Use best position we got
                } else {
                    reject(new Error('Timeout getting accurate location'));
                }
            }, options.timeout);
        });

        const { latitude, longitude, accuracy, altitude, heading, speed } = position.coords;

        // Validate coordinates with stricter checks
        if (!isValidCoordinates([latitude, longitude])) {
            throw new Error('Invalid coordinates received from GPS');
        }

        // Remove existing markers
        if (currentLocationMarker) {
            map.removeLayer(currentLocationMarker);
        }
        if (window.accuracyCircle) {
            map.removeLayer(window.accuracyCircle);
        }

        // Enhanced location icon
        const locationIcon = L.divIcon({
            className: 'current-location-marker',
            html: `
                <div class="pulse"></div>
                <div class="marker">📍</div>
                <div class="accuracy-indicator">${Math.round(accuracy)}m</div>
            `,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        // Create marker with fixed "Current Location" text
        const popupContent = `
            <div class="location-popup">
                <strong>Your Location: "Current Location"</strong><br>
                <small>Accuracy: ±${Math.round(accuracy)} meters</small>
            </div>
        `;

        // Add marker with the fixed popup content
        currentLocationMarker = L.marker([latitude, longitude], {
            icon: locationIcon
        }).addTo(map)
          .bindPopup(popupContent)
          .openPopup();

        // Even if we get the address, don't update the popup
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`
        );
        
        if (response.ok) {
            const data = await response.json();
            // Only update the input field, not the popup
            document.getElementById('startPoint').value = data.display_name;
        }

        // Add accuracy circle with gradient
        window.accuracyCircle = L.circle([latitude, longitude], {
            radius: accuracy,
            color: '#4285f4',
            fillColor: '#4285f4',
            fillOpacity: 0.15,
            weight: 2,
            dashArray: '5, 5',
            interactive: false
        }).addTo(map);

        // Zoom to location with better animation
        map.flyTo([latitude, longitude], 
            accuracy <= 50 ? 18 : accuracy <= 100 ? 17 : 16, {
            duration: 1.5,
            easeLinearity: 0.25
        });

    } catch (error) {
        console.error('Error:', error);
        alert(error.message);
    } finally {
        locationButton.innerHTML = originalButtonText;
        locationButton.disabled = false;
    }
}

// Helper function to format address
function formatAddress(addressData) {
    const components = [];
    
    if (addressData.road) components.push(addressData.road);
    if (addressData.suburb) components.push(addressData.suburb);
    if (addressData.city || addressData.town) components.push(addressData.city || addressData.town);
    if (addressData.state) components.push(addressData.state);
    if (addressData.postcode) components.push(addressData.postcode);
    
    return components.join(', ');
}

// Enhanced coordinate validation
function isValidCoordinates(coords) {
    return Array.isArray(coords) && 
           coords.length === 2 && 
           !isNaN(coords[0]) && 
           !isNaN(coords[1]) && 
           coords[0] >= -90 && 
           coords[0] <= 90 && 
           coords[1] >= -180 && 
           coords[1] <= 180 &&
           coords[0] !== 0 && 
           coords[1] !== 0;
}

async function findRoute() {
    const startPoint = document.getElementById('startPoint').value;
    const endPoint = document.getElementById('endPoint').value;

    if (!startPoint || !endPoint) {
        alert("Please enter both start point and destination");
        return;
    }

    try {
        // Show loading state
        document.getElementById('findRouteBtn').textContent = 'Finding Route...';
        
        let startCoords, endCoords;

        // Handle start point coordinates
        try {
            startCoords = await getCoordinates(startPoint);
            console.log('Start coordinates:', startCoords);
        } catch (error) {
            throw new Error(`Could not find location: ${startPoint}`);
        }

        // Handle end point coordinates
        try {
            endCoords = await getCoordinates(endPoint);
            console.log('End coordinates:', endCoords);
        } catch (error) {
            throw new Error(`Could not find location: ${endPoint}`);
        }

        // Validate coordinates
        if (!isValidCoordinates(startCoords) || !isValidCoordinates(endCoords)) {
            throw new Error('Invalid coordinates received');
        }

        // Remove existing route if any
        if (routingControl) {
            map.removeControl(routingControl);
        }

        // Create new routing control
        routingControl = L.Routing.control({
            waypoints: [
                L.latLng(startCoords[0], startCoords[1]),
                L.latLng(endCoords[0], endCoords[1])
            ],
            routeWhileDragging: false,
            lineOptions: {
                styles: [{ color: '#4285f4', weight: 6 }]
            },
            show: false,
            addWaypoints: false,
            draggableWaypoints: false,
            fitSelectedRoutes: true,
            showAlternatives: false
        }).addTo(map);

        // Handle route found event
        routingControl.on('routesfound', function(e) {
            const routes = e.routes;
            const route = routes[0]; // Get the first (best) route
            
            // Update route information in the right panel
            updateRouteInfo(route, startPoint, endPoint);

            // Fit the map to show the entire route with padding
            const bounds = L.latLngBounds([startCoords, endCoords]);
            map.fitBounds(bounds, { padding: [50, 50] });
        });

    } catch (error) {
        alert(error.message);
    } finally {
        // Reset button text
        document.getElementById('findRouteBtn').textContent = 'Find Route';
    }
}

// Add these helper functions

async function getCoordinates(location) {
    // Check if location is already in coordinate format (lat, lng)
    if (typeof location === 'string' && location.includes(',')) {
        const [lat, lng] = location.split(',').map(coord => parseFloat(coord.trim()));
        if (!isNaN(lat) && !isNaN(lng)) {
            return [lat, lng];
        }
    }

    // If not coordinates, geocode the location
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`
        );
        const data = await response.json();
        
        if (data.length === 0) {
            throw new Error(`Location not found: ${location}`);
        }
        
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    } catch (error) {
        console.error('Geocoding error:', error);
        throw new Error(`Error finding location: ${location}`);
    }
}

function updateRouteInfo(route, startPoint, endPoint) {
    const distance = (route.summary.totalDistance / 1000).toFixed(1);
    const duration = Math.round(route.summary.totalTime / 60);
    
    // Get route instructions
    const instructions = route.instructions.map(instruction => {
        return `<li>${instruction.text} (${(instruction.distance / 1000).toFixed(1)} km)</li>`;
    }).join('');
    
    const routeInfo = `
        <h2>Route Details</h2>
        <p class="route-stats">${distance} km, ${duration} min</p>
        <div class="directions">
            <p><strong>From:</strong> ${startPoint}</p>
            <p><strong>To:</strong> ${endPoint}</p>
            <h3>Directions:</h3>
            <ul class="route-instructions">
                ${instructions}
            </ul>
        </div>
        ${generateTrafficInfo()}
    `;
    
    const trafficInfo = document.getElementById('trafficInfo');
    trafficInfo.innerHTML = routeInfo;
    trafficInfo.style.display = 'block';
}

// Add these new functions for traffic simulation
function getTrafficData(location, coords) {
    const date = new Date();
    const hour = date.getHours();
    const day = date.getDay(); // 0 (Sunday) to 6 (Saturday)
    
    // Base traffic patterns for different times
    const trafficPatterns = {
        weekdayPeak: {
            trafficLevel: "Heavy",
            baseSpeed: 15,
            baseCongestion: 80
        },
        weekdayShoulder: {
            trafficLevel: "Moderate",
            baseSpeed: 30,
            baseCongestion: 50
        },
        weekdayOffPeak: {
            trafficLevel: "Light",
            baseSpeed: 50,
            baseCongestion: 20
        },
        weekend: {
            trafficLevel: "Moderate",
            baseSpeed: 35,
            baseCongestion: 40
        }
    };

    // Determine time period
    let pattern;
    if (day === 0 || day === 6) { // Weekend
        pattern = trafficPatterns.weekend;
    } else { // Weekday
        if ((hour >= 7 && hour <= 10) || (hour >= 16 && hour <= 19)) {
            pattern = trafficPatterns.weekdayPeak;
        } else if ((hour >= 11 && hour <= 15) || (hour >= 20 && hour <= 22)) {
            pattern = trafficPatterns.weekdayShoulder;
        } else {
            pattern = trafficPatterns.weekdayOffPeak;
        }
    }

    // Add random variations
    const randomVariation = () => (Math.random() - 0.5) * 20;
    const speedVariation = Math.max(5, Math.min(60, pattern.baseSpeed + randomVariation()));
    const congestionVariation = Math.max(0, Math.min(100, pattern.baseCongestion + randomVariation()));

    // Simulate weather impact
    const weatherImpact = simulateWeatherImpact(coords);

    // Adjust values based on weather
    const finalSpeed = Math.max(5, speedVariation * weatherImpact.speedMultiplier);
    const finalCongestion = Math.min(100, congestionVariation * weatherImpact.congestionMultiplier);

    // Determine final traffic level
    let trafficLevel;
    if (finalCongestion > 70) {
        trafficLevel = "Heavy";
    } else if (finalCongestion > 40) {
        trafficLevel = "Moderate";
    } else {
        trafficLevel = "Light";
    }

    // Get nearby roads status
    const nearbyRoads = generateNearbyRoadsStatus(location, trafficLevel);

    return {
        mainRoad: {
            trafficLevel: trafficLevel,
            averageSpeed: `${Math.round(finalSpeed)} km/h`,
            congestion: `${Math.round(finalCongestion)}%`,
            weather: weatherImpact.condition
        },
        nearbyRoads: nearbyRoads,
        timestamp: new Date().toISOString()
    };
}

function simulateWeatherImpact(coords) {
    // Simulate weather conditions based on coordinates and time
    const conditions = ['Clear', 'Rain', 'Cloudy', 'Light Rain'];
    const randomCondition = conditions[Math.floor(Math.random() * conditions.length)];
    
    let speedMultiplier = 1;
    let congestionMultiplier = 1;

    switch (randomCondition) {
        case 'Rain':
            speedMultiplier = 0.7;
            congestionMultiplier = 1.3;
            break;
        case 'Light Rain':
            speedMultiplier = 0.85;
            congestionMultiplier = 1.15;
            break;
        case 'Cloudy':
            speedMultiplier = 0.95;
            congestionMultiplier = 1.05;
            break;
    }

    return {
        condition: randomCondition,
        speedMultiplier,
        congestionMultiplier
    };
}

function generateNearbyRoadsStatus(location, mainTrafficLevel) {
    const roads = [
        `${location} Main Road`,
        `${location} Cross Road`,
        'Connecting Highway',
        'Parallel Street'
    ];

    return roads.map(road => {
        // Generate slightly different traffic levels for nearby roads
        const random = Math.random();
        let trafficLevel;
        
        if (mainTrafficLevel === "Heavy") {
            trafficLevel = random < 0.6 ? "Heavy" : random < 0.8 ? "Moderate" : "Light";
        } else if (mainTrafficLevel === "Moderate") {
            trafficLevel = random < 0.4 ? "Heavy" : random < 0.7 ? "Moderate" : "Light";
        } else {
            trafficLevel = random < 0.2 ? "Heavy" : random < 0.4 ? "Moderate" : "Light";
        }

        return {
            name: road,
            status: trafficLevel
        };
    });
}

// Update the getTrafficInfo function
async function getTrafficInfo() {
    const location = document.getElementById('locationSearch').value;
    if (!location) {
        alert("Please enter a location");
        return;
    }

    try {
        const coords = await getCoordinates(location);
        
        // Get simulated real-time traffic data
        const trafficData = getTrafficData(location, coords);
        
        // Show traffic info panel
        const trafficInfo = document.getElementById('trafficInfo');
        trafficInfo.style.display = 'block';

        // Update the UI with traffic data
        const trafficHtml = `
            <h2>${location}</h2>
            <div class="traffic-conditions">
                <h3>Current Traffic Conditions</h3>
                <ul>
                    <li>Traffic Level: <span class="${trafficData.mainRoad.trafficLevel.toLowerCase()}">${trafficData.mainRoad.trafficLevel}</span></li>
                    <li>Average Speed: ${trafficData.mainRoad.averageSpeed}</li>
                    <li>Congestion: ${trafficData.mainRoad.congestion}</li>
                    <li>Weather: ${trafficData.mainRoad.weather}</li>
                    <li>Last Updated: ${new Date().toLocaleTimeString()}</li>
                </ul>
            </div>
            <div class="nearby-roads">
                <h3>Nearby Roads Status</h3>
                ${trafficData.nearbyRoads.map(road => `
                    <div class="road-status">
                        <h4>${road.name}</h4>
                        <p>Status: <span class="${road.status.toLowerCase()}">${road.status}</span></p>
                    </div>
                `).join('')}
            </div>
        `;

        trafficInfo.innerHTML = trafficHtml;

        // Add marker to map
        if (currentLocationMarker) {
            map.removeLayer(currentLocationMarker);
        }

        // Create marker with traffic info
        currentLocationMarker = L.marker(coords)
            .addTo(map)
            .bindPopup(`
                <strong>${location}</strong><br>
                Traffic: ${trafficData.mainRoad.trafficLevel}<br>
                Speed: ${trafficData.mainRoad.averageSpeed}<br>
                Weather: ${trafficData.mainRoad.weather}
            `)
            .openPopup();

        map.setView(coords, 15);

    } catch (error) {
        alert("Error fetching traffic data: " + error.message);
    }
}

function generateTrafficInfo() {
    const hour = new Date().getHours();
    let trafficLevel = "Light";
    
    if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) {
        trafficLevel = "Heavy";
    } else if ((hour >= 11 && hour <= 16) || (hour >= 20 && hour <= 22)) {
        trafficLevel = "Moderate";
    }
    
    return `
        <div class="traffic-conditions">
            <h3>Current Traffic Conditions</h3>
            <ul>
                <li>Traffic Level: <span class="${trafficLevel.toLowerCase()}">${trafficLevel}</span></li>
                <li>Average Speed: ${trafficLevel === "Heavy" ? "10-20" : trafficLevel === "Moderate" ? "30-40" : "50-60"} km/h</li>
                <li>Congestion: ${trafficLevel === "Heavy" ? "80" : trafficLevel === "Moderate" ? "50" : "20"}%</li>
            </ul>
        </div>
    `;
}

// Also update the marker creation in any other functions that create markers
function addMarkerToMap(coords, popupContent) {
    if (currentLocationMarker) {
        map.removeLayer(currentLocationMarker);
    }

    currentLocationMarker = L.marker(coords)
        .addTo(map)
        .bindPopup(`
            <div class="location-popup">
                <strong>Your Location: Current Location</strong><br>
                <small>Accuracy: Available</small>
            </div>
        `)
        .openPopup();
} 