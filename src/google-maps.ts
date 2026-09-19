type GoogleWindow = Window & {
  google?: typeof google;
  __allanGoogleMapsReady?: () => void;
};

let googleMapsLoader: Promise<boolean> | null = null;

export function loadGoogleMaps() {
  const googleWindow = window as GoogleWindow;
  if (googleWindow.google?.maps?.Map) return Promise.resolve(true);
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) return Promise.resolve(false);
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise<boolean>(resolve => {
    let settled = false;
    const settle = (available: boolean, script?: HTMLScriptElement) => {
      if (settled) return;
      settled = true;
      if (!available) {
        script?.remove();
        googleMapsLoader = null;
      }
      resolve(available);
    };
    const finish = async () => {
      try {
        if (googleWindow.google?.maps?.importLibrary && !googleWindow.google.maps.places) {
          await googleWindow.google.maps.importLibrary("places").catch(() => undefined);
        }
        settle(Boolean(googleWindow.google?.maps?.Map));
      } catch {
        settle(Boolean(googleWindow.google?.maps?.Map));
      }
    };
    if (googleWindow.google?.maps?.Map) {
      void finish();
      return;
    }

    googleWindow.__allanGoogleMapsReady = () => {
      delete googleWindow.__allanGoogleMapsReady;
      void finish();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async&v=weekly&callback=__allanGoogleMapsReady`;
    script.async = true;
    script.dataset.allanGoogleMaps = "true";
    script.onerror = () => {
      delete googleWindow.__allanGoogleMapsReady;
      settle(false, script);
    };
    document.head.appendChild(script);
  });

  return googleMapsLoader;
}