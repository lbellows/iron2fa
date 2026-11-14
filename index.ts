// Must come first: installs crypto.getRandomValues on Hermes.
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
