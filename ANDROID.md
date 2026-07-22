# APK Android de Trackpi

Para generar una version nueva:

```powershell
cd C:\Trackpi
npm run android:apk
```

El instalador resultante queda en `C:\Trackpi\deliverables\Trackpi-Android.apk`.
Es una compilacion firmada para instalacion directa en moviles y tablets Android,
y puede convivir con la PWA anterior.

Nota: al renombrar la app (antes "Salvi Ruta", id `com.salvi.ruta`) el identificador
Android paso a ser `com.trackpi.app`. Android lo trata como una app distinta: en los
dispositivos con la version antigua hay que desinstalarla e instalar Trackpi.
