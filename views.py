from django.shortcuts import render, redirect
from django.conf import settings
from django.http import JsonResponse
from django.utils import timezone
import requests
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.contrib import messages
from django.views.decorators.csrf import ensure_csrf_cookie

@ensure_csrf_cookie
def login_view(request):
    if request.method == 'POST':
        username = request.POST.get('username')
        password = request.POST.get('password')
        user = authenticate(request, username=username, password=password)
        
        if user is not None:
            login(request, user)
            return redirect('index')
        else:
            return render(request, 'traffic_app/login.html', {
                'error': 'Invalid username or password'
            })
    
    return render(request, 'traffic_app/login.html')

@ensure_csrf_cookie
def register_view(request):
    if request.method == 'POST':
        form = UserCreationForm(request.POST)
        if form.is_valid():
            form.save()
            username = form.cleaned_data.get('username')
            messages.success(request, f'Account created for {username}!')
            return redirect('login')
    else:
        form = UserCreationForm()
    return render(request, 'traffic_app/register.html', {'form': form})

@login_required
def logout_view(request):
    logout(request)
    return redirect('login')

@login_required
def index(request):
    """
    Main view function that renders the index page
    """
    return render(request, 'traffic_app/index.html', {
        'TOMTOM_API_KEY': settings.TOMTOM_API_KEY
    })

def get_traffic_data(request):
    """
    API view to get traffic data for a given location
    """
    location = request.GET.get('location')
    if not location:
        return JsonResponse({'error': 'Location is required'}, status=400)

    try:
        # Geocoding request
        geocode_url = 'https://nominatim.openstreetmap.org/search'
        params = {
            'q': location,
            'format': 'json',
            'limit': 1
        }
        response = requests.get(geocode_url, params=params)
        data = response.json()

        if not data:
            return JsonResponse({'error': 'Location not found'}, status=404)

        # Get time-based traffic level
        hour = timezone.now().hour
        if 8 <= hour <= 10 or 17 <= hour <= 19:
            traffic_level = "Heavy"
        elif 11 <= hour <= 16 or 20 <= hour <= 22:
            traffic_level = "Moderate"
        else:
            traffic_level = "Light"

        # Mock traffic data
        traffic_data = {
            'location': location,
            'coordinates': {
                'lat': float(data[0]['lat']),
                'lon': float(data[0]['lon'])
            },
            'traffic_level': traffic_level,
            'timestamp': timezone.now().isoformat(),
            'current_conditions': {
                'overallTraffic': traffic_level,
                'averageSpeed': '45' if traffic_level == "Light" else '30' if traffic_level == "Moderate" else '15',
                'congestionLevel': 'Low' if traffic_level == "Light" else 'Medium' if traffic_level == "Moderate" else 'High'
            },
            'nearbyRoads': [
                {
                    'name': 'Main Street',
                    'status': traffic_level
                },
                {
                    'name': 'Cross Avenue',
                    'status': 'Moderate'
                }
            ]
        }

        return JsonResponse(traffic_data)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
