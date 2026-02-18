import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { AuthProvider } from './src/context/AuthContext';

// Screens
import DashboardScreen from './src/pages/Dashboard';
import LoginScreen from './src/pages/Login';
import RegisterScreen from './src/pages/Register';
import StudyGroupScreen from './src/pages/StudyGroup';
import WelcomeScreen from './src/pages/Welcome';

const Stack = createNativeStackNavigator();

function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Welcome"
          screenOptions={{
            headerShown: false,
            animation: 'fade',
          }}
        >
          <Stack.Screen name="Welcome" component={WelcomeScreen} />
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="EmailConfirmation" component={EmailConfirmationScreen} />
          <Stack.Screen 
            name="Dashboard" 
            component={DashboardScreen} 
            options={{
              gestureEnabled: false,
              headerLeft: () => null,
            }}
          />
          <Stack.Screen 
            name="StudyGroup" 
            component={StudyGroupScreen}
            options={{
              headerShown: true,
              title: 'Study Group',
              headerBackTitle: 'Back',
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </AuthProvider>
  );
}

export default App;
