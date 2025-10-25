import polyline from '@mapbox/polyline';
import * as Location from 'expo-location';
import { signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Dimensions, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { AuthErrorBoundary } from '../app/components/AuthErrorBoundary';
import { auth, db } from '../constants/firebase';
import { useAuth } from '../context/FirebaseAuthContext';
import { useTheme } from '../context/ThemeContext';
import DriverAuthScreen from './driver-auth';

const { width: screenWidth } = Dimensions.get('window');

const GOOGLE_DIRECTIONS_API_KEY = 'AIzaSyDvAwr2zV5NHj1oXVjToO0Eeg3KtxTpKzo';

// Additional API keys for enhanced features
const GOOGLE_PLACES_API_KEY = 'AIzaSyDvAwr2zV5NHj1oXVjToO0Eeg3KtxTpKzo'; // Same key works for multiple Google APIs
const GOOGLE_DISTANCE_MATRIX_API_KEY = 'AIzaSyDvAwr2zV5NHj1oXVjToO0Eeg3KtxTpKzo';

// Bus stops/landmarks for geofencing (SLSU Tayabas area)
const BUS_STOPS = [
  { id: 'slsu_tayabas', name: 'SLSU Tayabas Campus', lat: 14.0267, lng: 121.5928, radius: 100 },
  { id: 'tayabas_city_hall', name: 'Tayabas City Hall', lat: 14.0267, lng: 121.5940, radius: 50 },
  { id: 'tayabas_market', name: 'Tayabas Public Market', lat: 14.0285, lng: 121.5915, radius: 50 },
  { id: 'mauban_terminal', name: 'Mauban Terminal', lat: 13.9461, lng: 121.7308, radius: 50 },
  { id: 'tayabas_terminal', name: 'Tayabas Bus Terminal', lat: 14.0245, lng: 121.5895, radius: 50 },
  { id: 'sm_lucena', name: 'SM City Lucena', lat: 13.9372, lng: 121.6147, radius: 100 },
  // Add more local stops as needed
];

const DriverMapScreen = () => {
  const { user, userType, userName, isEmailVerified, isBlocked } = useAuth();
  const { theme, toggleTheme, isDark } = useTheme();
  const [sharing, setSharing] = useState(false);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number; heading?: number; speed?: number } | null>(null);
  const [route, setRoute] = useState<{ latitude: number; longitude: number }[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [selectedBusRoute, setSelectedBusRoute] = useState<string | null>(null);
  const [routeModalVisible, setRouteModalVisible] = useState(false);
  const [roadPolyline, setRoadPolyline] = useState<{ latitude: number; longitude: number }[]>([]);
  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const sharingRef = useRef(sharing);
  const userIdRef = useRef<string | null>(user?.uid ?? null);
  const displayNameRef = useRef<string>(displayName);

  // Keep refs in sync with latest values so unmount cleanup has current state
  useEffect(() => { sharingRef.current = sharing; }, [sharing]);
  useEffect(() => { userIdRef.current = user?.uid ?? null; }, [user]);
  useEffect(() => { displayNameRef.current = displayName; }, [displayName]);

  // Component mount state to prevent state updates on unmounted component
  const isMounted = useRef(true);

  // Enhanced state for new API features
  const [nearbyPlace, setNearbyPlace] = useState<string | null>(null);
  const [nearbyStops, setNearbyStops] = useState<any[]>([]);
  const [nextStopETAs, setNextStopETAs] = useState<any[]>([]);

  // Network connectivity state management
  const [isConnected, setIsConnected] = useState(true);
  const [pendingUpdates, setPendingUpdates] = useState<any[]>([]);

  // Available bus routes (should match those in your database)
  const availableBusRoutes = [
    { label: 'Tayabas ⇄ Mauban', value: 'tayabas-mauban' },
    { label: 'Mauban ⇄ Tayabas', value: 'mauban-tayabas' },
    // Add more routes as needed
  ];

  // Removed animation values since we're using static UI now

  // Centralized reset function to properly clear all states
  const resetAllStates = () => {
    setCurrentLocation(null);
    setRoute([]);
    setRoadPolyline([]);
    setNearbyPlace(null);
    setNearbyStops([]);
    setNextStopETAs([]);
  };

  // Cleanup on component unmount only (do NOT reset state on dependency changes)
  useEffect(() => {
    return () => {
      console.log('🔍 CLEANUP: Component unmounting, marking driver offline...');
      isMounted.current = false;

      // Mark driver offline when component unmounts (app closure)
      if (userIdRef.current && sharingRef.current) {
        setDoc(doc(db, 'vehicle_location', userIdRef.current), {
          id: userIdRef.current,
          online: false,
          display_name: displayNameRef.current,
          route: null,
          updated_at: new Date().toISOString(),
        }, { merge: true }).catch(error => {
          console.error('Error marking driver offline on unmount:', error);
        });
      }

      resetAllStates();
    };
  }, []);

  useEffect(() => {
    const initializeDriverData = async () => {
      // Set display name from auth context (from user_profiles collection)
      if (userName) {
        setDisplayName(userName);
      }

      // Only fetch driver-specific data if user is authenticated
      if (user?.uid) {
        try {
          // Fetch route from vehicle_location collection
          const userDoc = await getDoc(doc(db, 'vehicle_location', user.uid));

          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.route) {
              setSelectedBusRoute(data.route);
            }
          }
        } catch (locError) {
          console.error('Error fetching driver data:', locError);
        }
      }
    };

    initializeDriverData();

    // AuthContext handles all auth state changes now
    // No need for manual auth listener here

    return () => {
      // Cleanup function for component unmount
    };
  }, [user, userName]); // Re-run when user or userName changes

  // If user becomes blocked while sharing, stop sharing and mark offline
  useEffect(() => {
    if (isBlocked && sharing && user?.uid) {
      (async () => {
        try {
          await setDoc(doc(db, 'vehicle_location', user.uid), {
            id: user.uid,
            online: false,
            display_name: displayName,
            route: null,
            updated_at: new Date().toISOString(),
          }, { merge: true });
        } catch (e) {
          console.error('Error marking offline after block:', e);
        } finally {
          setSharing(false);
          resetAllStates();
          Alert.alert('Account Blocked', 'Your account has been blocked by an administrator. Location sharing has been stopped.');
        }
      })();
    }
  }, [isBlocked, sharing, user?.uid, displayName]);

  // Queue updates when offline, sync when back online
  const queueUpdate = useCallback(async (updateData: any) => {
    if (!user?.uid) {
      console.warn('🔍 WARNING: No user ID available for update');
      return false;
    }
    
    if (!isConnected) {
      setPendingUpdates(prev => [...prev, { ...updateData, timestamp: Date.now() }]);
      console.log('🔍 OFFLINE: Queued update for when connection returns');
      return false; // Indicate update was queued
    }
    
    // Send immediately if connected
    try {
      await setDoc(doc(db, 'vehicle_location', user.uid), updateData, { merge: true });
      return true; // Indicate update was sent successfully
    } catch (error) {
      console.error('🔍 ERROR: Failed to send update, queuing for retry:', error);
      setPendingUpdates(prev => [...prev, { ...updateData, timestamp: Date.now() }]);
      return false; // Indicate update was queued due to error
    }
  }, [user?.uid, isConnected]);

  useEffect(() => {
    // Ensure state updates are allowed for this effect run
    isMounted.current = true;
    if (!user || isBlocked) {
      // Stop location tracking if user is not authenticated
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
      // Clear state if blocked to ensure no leakage of location
      if (isBlocked) {
        resetAllStates();
      }
      return;
    }

    if (!sharing) {
      // Stop location tracking when sharing is disabled
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
      // Clear current location and route when sharing stops
      resetAllStates();
      return;
    }

    const startLocationTracking = async () => {
      try {
        // Request permissions
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          console.error('Location permission denied');
          Alert.alert('Permission Denied', 'Location permission is required to share your location');
          setSharing(false);
          return;
        }

        // Enhanced API Functions (defined inside component scope)

        // 1. Google Places API - Get nearby landmarks
        const getNearbyPlaces = async (lat: number, lng: number) => {
          try {
            if (!GOOGLE_PLACES_API_KEY) {
              return null;
            }
            const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=500&type=establishment&key=${GOOGLE_PLACES_API_KEY}`;
            const response = await fetch(url);
            if (!response.ok) {
              console.error('📍 Places API error:', response.status, response.statusText);
              return null;
            }
            const data = await response.json();
            if (data.results && data.results.length > 0) {
              return `Near ${data.results[0].name}`;
            }
            return null;
          } catch (error) {
            console.error('📍 Error getting nearby places:', error);
            return null;
          }
        };

        // 3. Geofencing
        const checkNearbyBusStops = (currentLat: number, currentLng: number) => {
          return BUS_STOPS.filter(stop => {
            const distance = calculateDistance(currentLat, currentLng, stop.lat, stop.lng) * 1000;
            return distance <= stop.radius;
          });
        };

        // 4. ETAs calculation
        const calculateETAsToStops = async (currentLat: number, currentLng: number) => {
          try {
            const destinations = BUS_STOPS.map(stop => `${stop.lat},${stop.lng}`).join('|');
            const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${currentLat},${currentLng}&destinations=${destinations}&mode=driving&key=${GOOGLE_DISTANCE_MATRIX_API_KEY}`;
            const response = await fetch(url);
            const data = await response.json();
            if (data.rows && data.rows[0] && data.rows[0].elements) {
              return data.rows[0].elements.map((element: any, index: number) => ({
                stopName: BUS_STOPS[index].name,
                duration: element.duration ? element.duration.text : 'N/A',
                distance: element.distance ? element.distance.text : 'N/A'
              }));
            }
            return [];
          } catch (error) {
            console.error('🕐 Error calculating ETAs:', error);
            return [];
          }
        };

        // Helper function
        const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
          const R = 6371;
          const dLat = (lat2 - lat1) * Math.PI / 180;
          const dLon = (lon2 - lon1) * Math.PI / 180;
          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };

        // Start watching location with improved real-time settings
        console.log('🔍 LOCATION: Starting location subscription...');

        locationSubscription.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation, // Highest accuracy for real-time tracking
            timeInterval: 2000, // Update every 2 seconds for real-time feel
            distanceInterval: 5, // Update every 5 meters for smoother tracking
          },
          async (location) => {
            // Defensive programming: ensure location.coords exists
            if (!location || !location.coords) {
              console.warn('Invalid location object received');
              return;
            }

            const coords = location.coords;
            const newLocation = {
              lat: coords.latitude,
              lng: coords.longitude,
              heading: coords.heading || 0, // Vehicle direction
              speed: coords.speed || 0, // Vehicle speed
            };

            // Smooth location update with animation (prevent frozen object errors)
            if (isMounted.current) {
              setCurrentLocation(prev => {
                if (prev) {
                  // Calculate if location changed significantly
                  const distance = Math.sqrt(
                    Math.pow(prev.lat - newLocation.lat, 2) +
                    Math.pow(prev.lng - newLocation.lng, 2)
                  );
                  // Only update if moved more than ~1 meter to avoid jitter
                  if (distance > 0.00001) {
                    console.log('🔍 LOCATION: Updating location (significant change):', newLocation);
                    return { ...newLocation }; // Create new object to avoid mutations
                  }
                  return prev;
                }
                console.log('🔍 LOCATION: Setting initial location:', newLocation);
                return { ...newLocation }; // Create new object to avoid mutations
              });
            }

            // Add to route with smart path optimization (prevent frozen object errors)
            if (isMounted.current) {
              setRoute(prev => {
                // Create a safe copy of previous array to avoid mutations
                const safePrev = Array.isArray(prev) ? [...prev] : [];
                const lastPoint = safePrev[safePrev.length - 1];

                // Only add new point if it's significantly different from last point
                if (!lastPoint ||
                  Math.abs(lastPoint.latitude - coords.latitude) > 0.00001 ||
                  Math.abs(lastPoint.longitude - coords.longitude) > 0.00001) {

                  const newPoint = {
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                  };

                  const updated = [...safePrev, newPoint];

                  // Keep only last 50 points for performance and smooth paths
                  const optimizedRoute = updated.length > 50 ? updated.slice(-50) : updated;

                  // Fetch road-following polyline for smoother paths
                  if (optimizedRoute.length > 1) {
                    fetchRoadPolyline(optimizedRoute);
                  }

                  return optimizedRoute;
                }
                return safePrev; // Return safe copy if no update needed
              });
            }

            // Real-time Firestore update with minimal lag + Enhanced APIs
            try {
              // Queue update if offline, otherwise proceed
              const updateData = {
                id: user.uid,
                lat: coords.latitude,
                lng: coords.longitude,
                heading: coords.heading || 0,
                speed: coords.speed || 0,
                online: true,
                display_name: displayName,
                route: selectedBusRoute,
                updated_at: new Date().toISOString(),
              };

              // Check network connectivity and queue or send update
              const canProceed = await queueUpdate(updateData);
              
              if (canProceed) {
                // Enhanced API calls for better user experience
                const [nearby, stops, etas] = await Promise.all([
                  getNearbyPlaces(coords.latitude, coords.longitude),
                  Promise.resolve(checkNearbyBusStops(coords.latitude, coords.longitude)),
                  calculateETAsToStops(coords.latitude, coords.longitude)
                ]);

                // Update state with enhanced data (only if component is still mounted)
                if (isMounted.current) {
                  if (nearby) setNearbyPlace(nearby);
                  setNearbyStops(stops);
                  setNextStopETAs(etas);
                }

                console.log('📍 Real-time location updated in Firestore with enhanced data');
              } else {
                console.log('🔍 OFFLINE: Update queued for later synchronization');
              }
            } catch (error) {
              console.error('Error updating location in Firestore:', error);
            }
          }
        );

        console.log('🔍 LOCATION EFFECT: Location tracking started successfully');

      } catch (error) {
        console.error('Error starting location tracking:', error);
        Alert.alert('Location Error', 'Failed to start location tracking');
        setSharing(false);
      }
    };

    // Enhanced helper to fetch smooth road-following polyline from Google Directions API
    const fetchRoadPolyline = async (points: { latitude: number; longitude: number }[]) => {
      // Skip if not sharing or not enough points
      if (!sharing || points.length < 2) return;

      try {
        // Use only start and end points for smoother API calls
        const origin = `${points[0].latitude},${points[0].longitude}`;
        const destination = `${points[points.length - 1].latitude},${points[points.length - 1].longitude}`;

        // Add intermediate waypoints only if route is long (more than 10 points)
        const waypoints = points.length > 10
          ? `&waypoints=optimize:true|${points.slice(1, -1)
            .filter((_, index) => index % 3 === 0) // Take every 3rd point to reduce API load
            .map(p => `${p.latitude},${p.longitude}`)
            .join('|')}`
          : '';

        const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}${waypoints}&mode=driving&optimize=true&key=${GOOGLE_DIRECTIONS_API_KEY}`;

        console.log('🛣️ Fetching smooth road polyline...');
        const response = await fetch(url);
        const data = await response.json();

        if (data.routes && data.routes.length > 0 && data.routes[0].overview_polyline) {
          const polylinePoints = data.routes[0].overview_polyline.points;
          const decoded = polyline.decode(polylinePoints).map((point: [number, number]) => ({
            latitude: point[0],
            longitude: point[1]
          }));

          // Smooth the polyline by removing unnecessary points
          const smoothedPolyline = smoothPolyline(decoded);
          if (isMounted.current) {
            setRoadPolyline(smoothedPolyline);
            console.log(`🛣️ Updated smooth polyline with ${smoothedPolyline.length} points`);
          }
        } else {
          console.log('🛣️ No route found, using direct polyline');
          if (isMounted.current) {
            setRoadPolyline(points);
          }
        }
      } catch (err) {
        console.error('🛣️ Error fetching smooth polyline:', err);
        // Fallback to direct line
        setRoadPolyline(points);
      }
    };

    // Helper function to smooth polyline by removing redundant points
    const smoothPolyline = (points: { latitude: number; longitude: number }[]) => {
      if (points.length <= 2) return points;

      const smoothed = [points[0]]; // Always keep first point

      for (let i = 1; i < points.length - 1; i++) {
        const prev = points[i - 1];
        const current = points[i];
        const next = points[i + 1];

        // Calculate if current point is necessary for the path
        const angle1 = Math.atan2(current.latitude - prev.latitude, current.longitude - prev.longitude);
        const angle2 = Math.atan2(next.latitude - current.latitude, next.longitude - current.longitude);
        const angleDiff = Math.abs(angle1 - angle2);

        // Keep point if it represents a significant direction change
        if (angleDiff > 0.1) { // ~5.7 degrees
          smoothed.push(current);
        }
      }

      smoothed.push(points[points.length - 1]); // Always keep last point
      return smoothed;
    };

    startLocationTracking();

    // Cleanup function
    return () => {
      isMounted.current = false; // Prevent state updates after cleanup
      if (locationSubscription.current) {
        console.log('🔍 LOCATION EFFECT: Cleaning up location subscription');
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
    };

  }, [sharing, user, displayName, selectedBusRoute, queueUpdate, isBlocked]);

  // Handle app state changes to update online status (background/minimize/terminate)
  useEffect(() => {
    console.log('🔍 APPSTATE EFFECT: Setting up AppState listener');
    function handleAppStateChange(nextAppState: string) {
      console.log('🔍 APPSTATE: State changed to:', nextAppState);
      
      // Mark offline when app goes to background OR inactive (pre-termination)
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (user && sharing) {
          console.log('🔍 APPSTATE: App backgrounded/inactive while sharing, updating online status to false');
          setDoc(doc(db, 'vehicle_location', user.uid), {
            id: user.uid,
            online: false,
            display_name: displayName,
            route: null, // Clear route when stopping
            updated_at: new Date().toISOString(),
          }, { merge: true }).catch(error => {
            console.error('Error updating online status on background/inactive:', error);
          });
        }
      } else if (nextAppState === 'active' && user && sharing) {
        // When app comes back to foreground and user was sharing, ensure online status is true
        console.log('🔍 APPSTATE: App foregrounded and sharing, ensuring online status');
        setDoc(doc(db, 'vehicle_location', user.uid), {
          id: user.uid,
          online: true,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        }, { merge: true }).catch(error => {
          console.error('Error updating online status on foreground:', error);
        });
      }
    }
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription?.remove();
    };
  }, [user, displayName, sharing]);

  // Mark driver offline in Firestore if app is terminated (stale timeout workaround)
  // This is a workaround: the user will be considered offline if their updated_at is too old (e.g., >60s)

  // Helper: is driver online (for use in user app, not here)
  // export function isDriverOnline(updatedAt: string, online: boolean) {
  //   const last = new Date(updatedAt).getTime();
  //   return online && (Date.now() - last < 60000); // 60s timeout
  // }

  // Function to save selected bus route
  const saveBusRoute = async (routeValue: string) => {
    if (!user?.uid) return;

    try {
      await setDoc(doc(db, 'vehicle_location', user.uid), {
        id: user.uid,
        route: routeValue,
        display_name: displayName,
        updated_at: new Date().toISOString(),
      }, { merge: true });

      setSelectedBusRoute(routeValue);
      setRouteModalVisible(false);
      Alert.alert('Success', 'Bus route saved successfully');
    } catch (error) {
      console.error('Error saving bus route:', error);
      Alert.alert('Error', 'Failed to save bus route');
    }
  };

  // Heartbeat system to keep driver status updated while sharing
  useEffect(() => {
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    if (sharing && user?.uid) {
      console.log('🔍 HEARTBEAT: Starting heartbeat for driver status');
      
      // Send heartbeat every 30 seconds while sharing
      heartbeatInterval = setInterval(async () => {
        try {
          await setDoc(doc(db, 'vehicle_location', user.uid), {
            id: user.uid,
            online: true,
            display_name: displayName,
            route: selectedBusRoute,
            updated_at: new Date().toISOString(),
          }, { merge: true });
          console.log('🔍 HEARTBEAT: Sent status update');
        } catch (error) {
          console.error('🔍 HEARTBEAT: Error sending heartbeat:', error);
        }
      }, 30000); // 30 seconds
    }

    return () => {
      if (heartbeatInterval) {
        console.log('🔍 HEARTBEAT: Stopping heartbeat');
        clearInterval(heartbeatInterval);
      }
    };
  }, [sharing, user, displayName, selectedBusRoute]);

  // Network connectivity monitoring
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        // Simple connectivity check by pinging a reliable service
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        const response = await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD',
          cache: 'no-cache',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        setIsConnected(response.ok);
      } catch {
        setIsConnected(false);
      }
    };

    // Check connectivity every 10 seconds
    const connectivityInterval = setInterval(checkConnectivity, 10000);
    checkConnectivity(); // Initial check

    return () => clearInterval(connectivityInterval);
  }, []);

  // Sync pending updates when connection returns
  useEffect(() => {
    if (isConnected && pendingUpdates.length > 0 && user?.uid) {
      console.log(`🔍 RECONNECT: Syncing ${pendingUpdates.length} pending updates`);
      
      const syncUpdates = async () => {
        try {
          // Get the most recent update (ignore older ones to avoid spam)
          const latestUpdate = pendingUpdates[pendingUpdates.length - 1];
          
          await setDoc(doc(db, 'vehicle_location', user.uid), {
            id: user.uid,
            ...latestUpdate,
            updated_at: new Date().toISOString(), // Use current time, not queued time
          }, { merge: true });
          
          console.log('🔍 RECONNECT: Successfully synced pending updates');
          setPendingUpdates([]); // Clear pending updates
        } catch (error) {
          console.error('🔍 RECONNECT: Error syncing pending updates:', error);
          // Keep updates in queue for next try
        }
      };
      
      syncUpdates();
    }
  }, [isConnected, pendingUpdates, user]);

  // Block access for unverified users
  if (!user || (userType !== null && userType !== 'driver') || !isEmailVerified) {
    console.log('🔍 DRIVER: Showing auth screen - user:', !!user, 'userType:', userType, 'isEmailVerified:', isEmailVerified);
    return (
      <AuthErrorBoundary>
        <DriverAuthScreen />
      </AuthErrorBoundary>
    );
  }

  return (
    <AuthErrorBoundary>
      <View style={{ flex: 1, backgroundColor: isDark ? '#0f1419' : '#f0f8f0' }}>
        {/* Ultra Modern Header with Glassmorphism */}
        <View style={{
          paddingTop: 50,
          paddingHorizontal: 24,
          paddingBottom: 18,
          backgroundColor: isDark ? 'rgba(26, 26, 26, 0.85)' : 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(20px)',
          borderBottomWidth: 1,
          borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.4 : 0.2,
          shadowRadius: 24,
          elevation: 16,
        }}>
          {/* Settings Button */}
          <TouchableOpacity
            onPress={() => setSettingsVisible(true)}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(46, 125, 50, 0.15)',
              justifyContent: 'center',
              alignItems: 'center',
              borderWidth: 1,
              borderColor: isDark ? 'rgba(76, 175, 80, 0.3)' : 'rgba(46, 125, 50, 0.3)',
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'column', gap: 3 }}>
              <View style={{
                width: 18,
                height: 2.5,
                backgroundColor: isDark ? '#4CAF50' : '#2E7D32',
                borderRadius: 1.25
              }} />
              <View style={{
                width: 18,
                height: 2.5,
                backgroundColor: isDark ? '#4CAF50' : '#2E7D32',
                borderRadius: 1.25
              }} />
              <View style={{
                width: 18,
                height: 2.5,
                backgroundColor: isDark ? '#4CAF50' : '#2E7D32',
                borderRadius: 1.25
              }} />
            </View>
          </TouchableOpacity>

          {/* App Brand with Tagline */}
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{
              color: isDark ? '#FFFFFF' : '#1a1a1a',
              fontSize: 24,
              fontWeight: '900',
              textAlign: 'center',
              letterSpacing: 0.5,
              textShadowColor: isDark ? 'rgba(76, 175, 80, 0.3)' : 'rgba(46, 125, 50, 0.3)',
              textShadowOffset: { width: 0, height: 2 },
              textShadowRadius: 4,
            }}>
              SLSU Track
            </Text>
            <Text style={{
              color: '#4CAF50',
              fontSize: 11,
              fontWeight: '700',
              textAlign: 'center',
              letterSpacing: 1.5,
              marginTop: 2,
              textTransform: 'uppercase',
            }}>
              Driver Portal
            </Text>
          </View>

          {/* Share Location Button */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ opacity: 1 }}>
              <TouchableOpacity
                style={{
                  paddingHorizontal: 18,
                  paddingVertical: 12,
                  borderRadius: 20,
                  backgroundColor: sharing ? '#FF5722' : (selectedBusRoute ? '#4CAF50' : '#999'),
                  shadowColor: '#000',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 6,
                  opacity: !selectedBusRoute && !sharing ? 0.6 : 1,
                }}
                onPress={async () => {
                  console.log('Share button pressed, current sharing:', sharing);

                  if (sharing) {
                    // Stopping sharing
                    console.log('🔍 DRIVER: Stopping sharing, updating online status to false');
                    try {
                      await setDoc(doc(db, 'vehicle_location', user.uid), {
                        id: user.uid,
                        online: false,
                        display_name: displayName,
                        route: null, // Clear route when stopping
                        updated_at: new Date().toISOString(),
                      }, { merge: true });
                      console.log('🔍 DRIVER: Successfully updated online status to false and cleared route');
                    } catch (error) {
                      console.error('Error updating online status:', error);
                    }
                    setSharing(false);
                    // Clear location, route, roadPolyline, and selected bus route when stopping
                    resetAllStates();
                    setSelectedBusRoute(null);
                  } else {
                    // Starting sharing - check if not blocked and route is selected first
                    if (isBlocked) {
                      Alert.alert('Account Blocked', 'You cannot start location sharing because your account is blocked.');
                      return;
                    }
                    if (!selectedBusRoute) {
                      Alert.alert(
                        'Route Required',
                        'Please select your bus route before starting location sharing.',
                        [
                          { text: 'OK', style: 'default' }
                        ]
                      );
                      return;
                    }

                    console.log('🔍 DRIVER: Starting sharing...');                        // Get current location immediately before starting sharing
                    try {
                      const { status } = await Location.requestForegroundPermissionsAsync();
                      if (status !== 'granted') {
                        Alert.alert('Permission Denied', 'Location permission is required to share your location');
                        return;
                      }

                      console.log('🔍 DRIVER: Getting current location...');

                      // Try to get high accuracy location first, fallback to lower accuracy if needed
                      console.log('🔍 DRIVER: Requesting location - this may take a few moments for high accuracy...');
                      Alert.alert(
                        'Getting Your Location',
                        'This may take a few moments depending on GPS signal strength. Please wait...',
                        [{ text: 'OK', style: 'default' }]
                      );
                      
                      let currentPos: Location.LocationObject;
                      try {
                        // Set a timeout for high accuracy to avoid waiting too long
                        const locationPromise = Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.High,
                        });
                        
                        // Add a timeout of 3 seconds for high accuracy
                        const timeoutPromise = new Promise<never>((_, reject) => 
                          setTimeout(() => reject(new Error('Location timeout')), 3000)
                        );
                        
                        // Race between the location and timeout
                        currentPos = await Promise.race([locationPromise, timeoutPromise]);
                        console.log('🔍 DRIVER: Got high accuracy location successfully');
                      } catch {
                        console.log('🔍 DRIVER: High accuracy failed or timed out, using balanced accuracy...');
                        // Fall back to balanced accuracy with faster results
                        currentPos = await Location.getCurrentPositionAsync({
                          accuracy: Location.Accuracy.Balanced,
                        });
                        console.log('🔍 DRIVER: Got balanced accuracy location');
                      }


                      if (currentPos && currentPos.coords) {
                        const initialLocation = {
                          lat: currentPos.coords.latitude,
                          lng: currentPos.coords.longitude,
                          heading: currentPos.coords.heading || 0,
                          speed: currentPos.coords.speed || 0,
                        };

                        // Set location immediately so marker shows up right away
                        setCurrentLocation(initialLocation);
                        console.log('🔍 DRIVER: Initial location set:', initialLocation);

                        // Update Firestore with initial location
                        await setDoc(doc(db, 'vehicle_location', user.uid), {
                          id: user.uid,
                          lat: currentPos.coords.latitude,
                          lng: currentPos.coords.longitude,
                          heading: currentPos.coords.heading || 0,
                          speed: currentPos.coords.speed || 0,
                          online: true,
                          display_name: displayName,
                          route: selectedBusRoute,
                          updated_at: new Date().toISOString(),
                        }, { merge: true });

                        // Now start sharing (this will trigger the location subscription)
                        setSharing(true);
                        console.log('🔍 DRIVER: Sharing started with initial location');
                      } else {
                        throw new Error('Unable to get current location');
                      }
                    } catch (error) {
                      console.error('🔍 DRIVER: Error getting initial location:', error);
                      Alert.alert(
                        'Location Error',
                        'Unable to get your current location. Please check your GPS settings and try again.',
                        [{ text: 'OK', style: 'default' }]
                      );
                    }
                  }
                }}
                activeOpacity={0.8}
              >
                <Text style={{
                  color: '#fff',
                  fontSize: 16,
                  fontWeight: 'bold',
                }}>
                  {sharing ? 'STOP' : isBlocked ? 'BLOCKED' : (selectedBusRoute ? 'START' : 'Select Route')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Enhanced Full Screen Map with Real-time Tracking */}
        <View style={{ flex: 1, position: 'relative' }}>
          <MapView
            style={{ flex: 1 }}
            initialRegion={{
              latitude: currentLocation?.lat || 14.0267, // Default to SLSU Tayabas
              longitude: currentLocation?.lng || 121.5928,
              latitudeDelta: 0.005, // Smaller delta for closer zoom during tracking
              longitudeDelta: 0.005,
            }}
            region={currentLocation ? {
              latitude: currentLocation.lat,
              longitude: currentLocation.lng,
              latitudeDelta: sharing ? 0.005 : 0.01, // Closer zoom when actively sharing
              longitudeDelta: sharing ? 0.005 : 0.01,
            } : undefined}
            showsUserLocation={false} // We'll use our custom marker instead
            showsMyLocationButton={false}
            followsUserLocation={sharing} // Follow user when sharing
            showsCompass={true}
            showsScale={true}
            showsTraffic={true} // Show traffic like Waze
            mapType="standard"
            loadingEnabled={true}
            moveOnMarkerPress={false}
            pitchEnabled={true}
            rotateEnabled={true}
            scrollEnabled={true}
            zoomEnabled={true}
            customMapStyle={isDark ? [
              {
                "elementType": "geometry",
                "stylers": [{ "color": "#242f3e" }]
              },
              {
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#746855" }]
              },
              {
                "elementType": "labels.text.stroke",
                "stylers": [{ "color": "#242f3e" }]
              },
              {
                "featureType": "administrative.locality",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#d59563" }]
              },
              {
                "featureType": "poi",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#d59563" }]
              },
              {
                "featureType": "poi.park",
                "elementType": "geometry",
                "stylers": [{ "color": "#263c3f" }]
              },
              {
                "featureType": "poi.park",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#6b9a76" }]
              },
              {
                "featureType": "road",
                "elementType": "geometry",
                "stylers": [{ "color": "#38414e" }]
              },
              {
                "featureType": "road",
                "elementType": "geometry.stroke",
                "stylers": [{ "color": "#212a37" }]
              },
              {
                "featureType": "road",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#9ca5b3" }]
              },
              {
                "featureType": "road.highway",
                "elementType": "geometry",
                "stylers": [{ "color": "#746855" }]
              },
              {
                "featureType": "road.highway",
                "elementType": "geometry.stroke",
                "stylers": [{ "color": "#1f2835" }]
              },
              {
                "featureType": "road.highway",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#f3d19c" }]
              },
              {
                "featureType": "transit",
                "elementType": "geometry",
                "stylers": [{ "color": "#2f3948" }]
              },
              {
                "featureType": "transit.station",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#d59563" }]
              },
              {
                "featureType": "water",
                "elementType": "geometry",
                "stylers": [{ "color": "#17263c" }]
              },
              {
                "featureType": "water",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#515c6d" }]
              },
              {
                "featureType": "water",
                "elementType": "labels.text.stroke",
                "stylers": [{ "color": "#17263c" }]
              }
            ] : []}
          >
            {/* Custom navigation arrow marker */}
            {currentLocation && (
              <Marker
                coordinate={{
                  latitude: currentLocation.lat,
                  longitude: currentLocation.lng,
                }}
                title={displayName || 'My Location'}
                description={`Speed: ${Math.round((currentLocation.speed || 0) * 3.6)} km/h`}
                anchor={{ x: 0.5, y: 0.5 }}
                rotation={currentLocation.heading || 0}
              >
                <View style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 40,
                  height: 40,
                }}>
                  {/* Custom red navigation arrow - replace with your image */}
                  {/* 
                  To use your custom navigation arrow image, uncomment the Image component below
                  and replace the View with CSS arrow:
                  
                  <Image
                    source={require('../../assets/images/navigation-arrow.png')}
                    style={{
                      width: 32,
                      height: 32,
                      tintColor: '#FF3B30',
                    }}
                    resizeMode="contain"
                  />
                  */}
                  
                  {/* CSS-based red navigation arrow (current implementation) */}
                  <View style={{
                    width: 32,
                    height: 32,
                    backgroundColor: '#FF3B30',
                    borderRadius: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.3,
                    shadowRadius: 4,
                    elevation: 6,
                    borderWidth: 2,
                    borderColor: '#FFFFFF',
                  }}>
                    {/* Navigation arrow icon */}
                    <View style={{
                      width: 0,
                      height: 0,
                      borderLeftWidth: 6,
                      borderRightWidth: 6,
                      borderBottomWidth: 12,
                      borderLeftColor: 'transparent',
                      borderRightColor: 'transparent',
                      borderBottomColor: '#FFFFFF',
                      transform: [{ rotate: '0deg' }],
                    }} />
                  </View>
                </View>
              </Marker>
            )}

            {/* Polylines for route drawing - conditionally rendered based on sharing status */}
            {sharing && roadPolyline.length > 1 ? (
              <>
                {/* Road-following path with stroke */}
                <Polyline
                  coordinates={roadPolyline}
                  strokeColor={isDark ? '#1A1A1A' : '#FFFFFF'}
                  strokeWidth={8}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={1}
                />
                {/* Main route line */}
                <Polyline
                  coordinates={roadPolyline}
                  strokeColor="#4CAF50"
                  strokeWidth={5}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={2}
                />
                {/* Recent path overlay for better visual feedback */}
                {route.length > 1 && (
                  <Polyline
                    coordinates={route.slice(-10)} // Last 10 points for recent path highlight
                    strokeColor="#81C784"
                    strokeWidth={3}
                    lineCap="round"
                    lineJoin="round"
                    zIndex={3}
                  />
                )}
              </>
            ) : sharing && route.length > 1 ? (
              <>
                {/* Fallback direct route with outer stroke */}
                <Polyline
                  coordinates={route}
                  strokeColor={isDark ? '#1A1A1A' : '#FFFFFF'}
                  strokeWidth={6}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={1}
                />
                <Polyline
                  coordinates={route}
                  strokeColor="#4CAF50"
                  strokeWidth={3}
                  lineCap="round"
                  lineJoin="round"
                  zIndex={2}
                />
              </>
            ) : null}
          </MapView>

          {/* Enhanced Modern Info Card */}
          <View style={[{
            position: 'absolute',
            bottom: 24,
            left: 20,
            right: 20,
            backgroundColor: isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(20px)',
            borderRadius: 20,
            padding: 20,
            borderWidth: 1,
            borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 12 },
            shadowOpacity: isDark ? 0.6 : 0.15,
            shadowRadius: 24,
            elevation: 16,
            opacity: 1, // Fixed opacity instead of animated
          }]}>
            {/* Status Header with Modern Design */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 16,
              paddingBottom: 12,
              borderBottomWidth: 1,
              borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
            }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: sharing ? 'rgba(76, 175, 80, 0.2)' : 'rgba(158, 158, 158, 0.2)',
                paddingHorizontal: 16,
                paddingVertical: 8,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: sharing ? 'rgba(76, 175, 80, 0.3)' : 'rgba(158, 158, 158, 0.3)',
              }}>
                <View style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: sharing ? '#4CAF50' : '#9E9E9E',
                  marginRight: 8,
                  opacity: sharing ? 1 : 0.7,
                }}>
                  {sharing && <View style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#4CAF50',
                  }} />}
                </View>
                <Text style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: sharing ? '#4CAF50' : (isDark ? '#9E9E9E' : '#666'),
                  letterSpacing: 0.5,
                }}>
                  {sharing ? 'SHARING LOCATION' : 'LOCATION SHARING OFF'}
                </Text>
              </View>

              {/* Driver status badge */}
              {currentLocation && (
                <View style={{
                  backgroundColor: isDark ? 'rgba(33, 150, 243, 0.2)' : 'rgba(33, 150, 243, 0.2)',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: isDark ? 'rgba(33, 150, 243, 0.3)' : 'rgba(33, 150, 243, 0.3)',
                }}>
                  <Text style={{
                    fontSize: 13,
                    fontWeight: '700',
                    color: '#2196F3',
                  }}>
                    {Math.round((currentLocation.speed || 0) * 3.6)} km/h
                  </Text>
                </View>
              )}
            </View>

            {/* Modern Route Selection */}
            <View style={{
              backgroundColor: isDark ? 'rgba(76, 175, 80, 0.08)' : 'rgba(46, 125, 50, 0.08)',
              borderRadius: 16,
              padding: 16,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(76, 175, 80, 0.2)' : 'rgba(46, 125, 50, 0.2)',
            }}>
              <Text style={{
                fontSize: 14,
                fontWeight: '700',
                color: '#4CAF50',
                marginBottom: 12,
                textAlign: 'center',
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}>
                🛣️ Active Route
              </Text>

              <TouchableOpacity
                style={{
                  backgroundColor: selectedBusRoute
                    ? (isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(46, 125, 50, 0.15)')
                    : (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'),
                  borderWidth: 2,
                  borderColor: selectedBusRoute
                    ? '#4CAF50'
                    : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'),
                  borderRadius: 12,
                  padding: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
                onPress={() => setRouteModalVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={{
                  fontSize: 14,
                  fontWeight: '600',
                  color: selectedBusRoute
                    ? '#4CAF50'
                    : (isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)'),
                  flex: 1,
                  textAlign: 'center',
                }}>
                  {selectedBusRoute
                    ? availableBusRoutes.find(r => r.value === selectedBusRoute)?.label || 'Unknown Route'
                    : '📍 Tap to select your route'
                  }
                </Text>
                <Text style={{
                  fontSize: 12,
                  color: '#4CAF50',
                  marginLeft: 8,
                  fontWeight: '600',
                }}>
                  ▼
                </Text>
              </TouchableOpacity>

              {!selectedBusRoute && (
                <Text style={{
                  fontSize: 12,
                  color: '#F44336',
                  textAlign: 'center',
                  marginTop: 8,
                  fontWeight: '600',
                  fontStyle: 'italic',
                }}>
                  ⚠️ Route selection required for location sharing
                </Text>
              )}
            </View>

            {/* Location Stats (only when sharing) - Enhanced with APIs */}
            {currentLocation && sharing && (
              <View style={{
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                borderRadius: 12,
                padding: 16,
                borderWidth: 1,
                borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }}>
                {/* Location Info Row */}
                <View style={{
                  marginBottom: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                  paddingBottom: 10
                }}>
                  {/* Location */}
                  <View style={{ flex: 1 }}>
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: isDark ? '#BBDEFB' : '#1976D2',
                      marginBottom: 4,
                    }}>
                      📍 CURRENT LOCATION
                    </Text>
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                    }} numberOfLines={2} ellipsizeMode="tail">
                      {nearbyPlace || `${currentLocation.lat.toFixed(5)}, ${currentLocation.lng.toFixed(5)}`}
                    </Text>
                  </View>
                </View>

                {/* Bus Stops Info */}
                <View style={{
                  marginBottom: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                  paddingBottom: 10
                }}>
                  <Text style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: isDark ? '#FFCCBC' : '#E64A19',
                    marginBottom: 4,
                  }}>
                    🚏 BUS STOPS
                  </Text>

                  {/* Nearby stops */}
                  {nearbyStops.length > 0 ? (
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                    }} numberOfLines={2} ellipsizeMode="tail">
                      <Text style={{ color: '#FF9800', fontWeight: '700' }}>Nearby: </Text>
                      {nearbyStops.map(stop => stop.name).join(', ')}
                    </Text>
                  ) : (
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)',
                      fontStyle: 'italic',
                    }}>
                      No bus stops nearby
                    </Text>
                  )}

                  {/* ETAs to next stops */}
                  {nextStopETAs.length > 0 && nextStopETAs[0].duration !== 'N/A' && (
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                      marginTop: 4,
                    }}>
                      <Text style={{ color: '#2196F3', fontWeight: '700' }}>Next: </Text>
                      {nextStopETAs[0].stopName} in {nextStopETAs[0].duration} ({nextStopETAs[0].distance})
                    </Text>
                  )}
                </View>

                {/* Route Statistics */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: isDark ? '#C8E6C9' : '#388E3C',
                      marginBottom: 4,
                    }}>
                      📊 STATS
                    </Text>
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                    }}>
                      Route Points: {route.length} | Polyline: {roadPolyline.length}
                    </Text>
                  </View>

                  <View style={{
                    backgroundColor: sharing ? 'rgba(76, 175, 80, 0.2)' : 'rgba(158, 158, 158, 0.2)',
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 12,
                    alignSelf: 'flex-end',
                  }}>
                    <Text style={{
                      fontSize: 12,
                      fontWeight: '700',
                      color: '#4CAF50',
                    }}>
                      🎯 LIVE
                    </Text>
                  </View>
                </View>
              </View>
            )}

            {/* Status Message */}
            <Text style={{
              fontSize: 13,
              color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
              textAlign: 'center',
              fontWeight: '500',
              lineHeight: 18,
              marginTop: 12,
              fontStyle: 'italic',
            }}>
              {sharing
                ? '🎯 Your location is being tracked by students in real-time'
                : selectedBusRoute
                  ? '▶️ Ready to start - tap the "START" button above'
                  : '📍 Please select your route to enable location sharing'
              }
            </Text>
          </View>
        </View>

        {/* Enhanced Modern Settings Modal */}
        <Modal
          visible={settingsVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setSettingsVisible(false)}
        >
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}>
            <View style={{
              width: Math.min(screenWidth - 40, 400),
              backgroundColor: isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: isDark ? 0.6 : 0.25,
              shadowRadius: 24,
              elevation: 16,
              opacity: 1,
            }}>
              {/* Modern Header */}
              <View style={{
                alignItems: 'center',
                marginBottom: 24,
                paddingBottom: 16,
                borderBottomWidth: 1,
                borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }}>
                <Text style={{
                  fontSize: 22,
                  fontWeight: '800',
                  color: '#4CAF50',
                  marginBottom: 8,
                  textAlign: 'center',
                  letterSpacing: 0.5,
                }}>
                  🚐 Driver Settings
                </Text>
                <Text style={{
                  fontSize: 14,
                  color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
                  textAlign: 'center',
                  fontWeight: '500',
                }}>
                  Configure your driver profile
                </Text>
              </View>

              {/* Settings content */}
              <View style={{ width: '100%' }}>
                {/* Display Name Section */}
                <Text style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: '#4CAF50',
                  marginBottom: 8,
                  letterSpacing: 0.3,
                }}>
                  🏷️ Display Name
                </Text>
                <TextInput
                  style={{
                    borderWidth: 2,
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 20,
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                    color: isDark ? '#FFFFFF' : '#000000',
                    fontSize: 16,
                    fontWeight: '500',
                  }}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Enter your display name"
                  placeholderTextColor={isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.5)'}
                  maxLength={50}
                />

                {/* Save Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: savingName ? '#A5D6A7' : '#4CAF50',
                    paddingVertical: 14,
                    borderRadius: 20,
                    marginBottom: 12,
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 8,
                    elevation: 6,
                    opacity: savingName ? 0.7 : 1,
                  }}
                  onPress={async () => {
                    if (!displayName.trim()) {
                      Alert.alert('Error', 'Please enter a display name');
                      return;
                    }

                    setSavingName(true);
                    try {
                      await setDoc(doc(db, 'user_profiles', user.uid), {
                        display_name: displayName.trim(),
                        updated_at: new Date().toISOString(),
                      }, { merge: true });

                      await setDoc(doc(db, 'vehicle_location', user.uid), {
                        display_name: displayName.trim(),
                        updated_at: new Date().toISOString(),
                      }, { merge: true });

                      Alert.alert('Success', 'Display name saved successfully');
                      setSettingsVisible(false);
                    } catch (error) {
                      console.error('Error saving display name:', error);
                      Alert.alert('Error', 'Failed to save display name');
                    } finally {
                      setSavingName(false);
                    }
                  }}
                  disabled={savingName}
                >
                  <Text style={{
                    color: '#fff',
                    fontWeight: '700',
                    fontSize: 16,
                    letterSpacing: 0.3,
                  }}>
                    {savingName ? '💾 Saving...' : '💾 Save Display Name'}
                  </Text>
                </TouchableOpacity>

                {/* Theme Toggle */}
                <TouchableOpacity
                  style={{
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                    borderWidth: 2,
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                    paddingVertical: 12,
                    borderRadius: 12,
                    marginBottom: 16,
                    alignItems: 'center',
                  }}
                  onPress={() => {
                    console.log('Theme toggle pressed from settings, current theme:', theme);
                    toggleTheme();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={{
                    fontWeight: '700',
                    fontSize: 15,
                    color: isDark ? '#FFFFFF' : '#000000',
                    letterSpacing: 0.3,
                  }}>
                    {isDark ? '☀️ Switch to Light Mode' : '🌙 Switch to Dark Mode'}
                  </Text>
                </TouchableOpacity>

                {/* Developer Credits */}
                <View style={{
                  marginTop: 16,
                  paddingTop: 16,
                  borderTopWidth: 1,
                  borderTopColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                  alignItems: 'center',
                  marginBottom: 16,
                }}>
                  <Text style={{
                    fontSize: 14,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginBottom: 12,
                    color: '#4CAF50',
                    letterSpacing: 0.5,
                  }}>
                    👨‍💻 Developed by
                  </Text>
                  <View style={{ width: '100%', gap: 8, marginBottom: 12 }}>
                    <View style={{
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderLeftWidth: 3,
                      borderLeftColor: '#4CAF50',
                    }}>
                      <Text style={{
                        fontSize: 13,
                        fontWeight: '700',
                        marginBottom: 2,
                        color: '#4CAF50',
                      }}>
                        🔥 Meljhon Quarteros
                      </Text>
                      <Text style={{
                        fontSize: 11,
                        fontWeight: '500',
                        color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
                      }}>
                        Lead Developer
                      </Text>
                    </View>
                    <View style={{
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderLeftWidth: 3,
                      borderLeftColor: '#4CAF50',
                    }}>
                      <Text style={{
                        fontSize: 13,
                        fontWeight: '700',
                        marginBottom: 2,
                        color: '#4CAF50',
                      }}>
                        ⚡ Vaness Andrei Repique
                      </Text>
                      <Text style={{
                        fontSize: 11,
                        fontWeight: '500',
                        color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
                      }}>
                        Frontend Developer
                      </Text>
                    </View>
                  </View>
                  <Text style={{
                    fontSize: 10,
                    fontWeight: '500',
                    textAlign: 'center',
                    fontStyle: 'italic',
                    color: isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
                  }}>
                    Built with ❤️ for SLSU Students
                  </Text>
                </View>

                {/* Logout Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderColor: '#F44336',
                    paddingVertical: 12,
                    borderRadius: 12,
                    marginBottom: 16,
                    alignItems: 'center',
                  }}
                  onPress={async () => {
                    Alert.alert(
                      'Logout',
                      'Are you sure you want to logout?',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Logout',
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await setDoc(doc(db, 'vehicle_location', user.uid), {
                                id: user.uid,
                                online: false,
                                display_name: displayName,
                                updated_at: new Date().toISOString(),
                              }, { merge: true });

                              await firebaseSignOut(auth);
                              setSettingsVisible(false);
                            } catch (error) {
                              console.error('Error during logout:', error);
                              Alert.alert('Error', 'Failed to logout');
                            }
                          }
                        }
                      ]
                    );
                  }}
                >
                  <Text style={{
                    color: '#F44336',
                    fontWeight: '700',
                    fontSize: 15,
                    letterSpacing: 0.3,
                  }}>
                    🚪 Logout
                  </Text>
                </TouchableOpacity>

                {/* Cancel Button */}
                <TouchableOpacity onPress={() => setSettingsVisible(false)}>
                  <Text style={{
                    color: isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
                    fontSize: 15,
                    textAlign: 'center',
                    marginTop: 8,
                    fontWeight: '600',
                  }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Modern Route Selection Modal */}
        <Modal
          visible={routeModalVisible}
          animationType="slide"
          transparent
          onRequestClose={() => setRouteModalVisible(false)}
        >
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}>
            <View style={{
              width: Math.min(screenWidth - 40, 400),
              backgroundColor: isDark ? 'rgba(26, 26, 26, 0.95)' : 'rgba(255, 255, 255, 0.95)',
              backdropFilter: 'blur(20px)',
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: isDark ? 0.6 : 0.25,
              shadowRadius: 24,
              elevation: 16,
              opacity: 1, // Fixed opacity instead of animated
            }}>
              {/* Modern Header */}
              <View style={{
                alignItems: 'center',
                marginBottom: 24,
                paddingBottom: 16,
                borderBottomWidth: 1,
                borderBottomColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
              }}>
                <Text style={{
                  fontSize: 22,
                  fontWeight: '800',
                  color: '#4CAF50',
                  marginBottom: 8,
                  textAlign: 'center',
                  letterSpacing: 0.5,
                }}>
                  🛣️ Select Route
                </Text>
                <Text style={{
                  fontSize: 14,
                  color: isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
                  textAlign: 'center',
                  fontWeight: '500',
                }}>
                  Choose the route for your vehicle
                </Text>
              </View>
              <View style={{ width: '100%' }}>
                {availableBusRoutes.map((routeItem) => (
                  <TouchableOpacity
                    key={routeItem.value}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 16,
                      borderRadius: 16,
                      marginBottom: 12,
                      backgroundColor: selectedBusRoute === routeItem.value
                        ? (isDark ? 'rgba(76, 175, 80, 0.2)' : 'rgba(46, 125, 50, 0.2)')
                        : (isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'),
                      borderWidth: 2,
                      borderColor: selectedBusRoute === routeItem.value
                        ? '#4CAF50'
                        : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'),
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: selectedBusRoute === routeItem.value ? 0.2 : 0.05,
                      shadowRadius: 4,
                      elevation: selectedBusRoute === routeItem.value ? 4 : 1,
                    }}
                    onPress={() => saveBusRoute(routeItem.value)}
                    activeOpacity={0.8}
                  >
                    <Text style={{
                      fontSize: 16,
                      fontWeight: '600',
                      color: selectedBusRoute === routeItem.value
                        ? '#4CAF50'
                        : (isDark ? '#FFFFFF' : '#000000'),
                      flex: 1,
                    }}>
                      {routeItem.label}
                    </Text>
                    {selectedBusRoute === routeItem.value && (
                      <View style={{
                        backgroundColor: '#4CAF50',
                        borderRadius: 12,
                        padding: 4,
                        marginLeft: 8,
                      }}>
                        <Text style={{
                          fontSize: 14,
                          color: '#FFFFFF',
                          fontWeight: '700',
                        }}>
                          ✓
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}

                {/* Close Button */}
                <TouchableOpacity
                  onPress={() => setRouteModalVisible(false)}
                  style={{
                    marginTop: 16,
                    paddingVertical: 12,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{
                    color: isDark ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
                    fontSize: 15,
                    fontWeight: '600',
                  }}>
                    Close
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </AuthErrorBoundary>
  );
};

export default DriverMapScreen;