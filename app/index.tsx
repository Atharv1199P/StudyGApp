import { useAuth } from '@/src/context/AuthContext';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  const { userData, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0b1220', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#0ea5e9" size="large" />
      </View>
    );
  }

  if (userData) {
    return <Redirect href="/dashboard" />;
  }

  return <Redirect href="/welcome" />;
}
