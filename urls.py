from django.urls import path
from . import views
from django.contrib.auth.decorators import login_required

urlpatterns = [
    path('', views.login_view, name='login'),  # Make login the default page
    path('home/', login_required(views.index), name='index'),  # Protected home page
    path('register/', views.register_view, name='register'),
    path('logout/', views.logout_view, name='logout'),
    path('api/traffic-data/', views.get_traffic_data, name='traffic_data'),
] 