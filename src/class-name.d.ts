// `className` reaches the core components when the app resolves it (Uniwind
// redirects `react-native` imports to components that read it). Elsewhere it
// is ignored.
import 'react-native';

declare module 'react-native' {
  interface TextProps {
    className?: string;
  }
  interface ViewProps {
    className?: string;
  }
}
