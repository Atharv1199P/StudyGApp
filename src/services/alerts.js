import { Alert, Platform } from 'react-native';

export const showAlert = (title, message, buttons) => {
    if (Platform.OS === 'web') {
        if (buttons && buttons.length > 1) {
            // Find the primary or destructive button
            const confirmBtn = buttons.find(b =>
                (b.style === 'destructive') ||
                (b.text && ['delete', 'logout', 'confirm', 'yes', 'ok'].includes(b.text.toLowerCase()))
            );
            if (window.confirm(`${title}\n\n${message || ''}`)) {
                if (confirmBtn && confirmBtn.onPress) confirmBtn.onPress();
            } else {
                const cancelBtn = buttons.find(b =>
                    (b.style === 'cancel') ||
                    (b.text && ['cancel', 'no'].includes(b.text.toLowerCase()))
                );
                if (cancelBtn && cancelBtn.onPress) cancelBtn.onPress();
            }
        } else {
            window.alert(`${title}${message ? ': ' + message : ''}`);
            if (buttons && buttons[0] && buttons[0].onPress) buttons[0].onPress();
        }
    } else {
        Alert.alert(title, message, buttons);
    }
};
