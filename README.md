# Trackpi

Aplicación web instalable para planificar una ruta en coche con tiempos de parada y abrirla después en Google Maps para navegación giro a giro.

## Ejecutar en local

```powershell
cd C:\Trackpi
npm install
npm run dev
```

Abre `http://localhost:4173`.

## Incluido en este MVP

- Búsqueda de direcciones, comercios y lugares con prioridad España, Catalunya, Girona y cercanía al punto de salida.
- Corrección de búsquedas catalanas incompletas y orden por intención (estaciones, aeropuertos, centros comerciales, etc.).
- Inicio rápido desde la ubicación actual.
- Puntos añadidos tocando el mapa.
- Reordenación manual y ordenación rápida de paradas intermedias.
- Duración común o individual para cada visita.
- Distancia, conducción, tiempo de paradas, total y llegada estimada.
- Persistencia automática de la ruta en el dispositivo.
- Biblioteca de rutas guardadas con nombre opcional, reapertura y eliminación.
- Biblioteca independiente de puntos de recogida con nombre personalizado, reutilización y eliminación.
- Perfil sencillo con nombre y código privado de miembro.
- Contactos, mensajes privados y avisos de mensajes sin leer.
- Envío directo de cualquier ruta guardada desde `Mis rutas` y desde una conversación.
- Apertura y guardado de las rutas recibidas dentro de la propia app.
- App instalable (PWA).
- Apertura de la ruta en Google Maps con navegación.
- Detección previa de zonas amplias de vigilancia de velocidad en el tramo francés.
- Desactivación completa de avisos de controles en Suiza por cumplimiento legal.

## Servicios y paso a producción

Los perfiles, contactos, mensajes y rutas compartidas usan un proyecto Supabase exclusivo de Trackpi. Las conversaciones están protegidas para que solo emisor y receptor puedan leerlas; la clave administrativa no se incluye en la app.

El prototipo usa mapas de OpenStreetMap, búsqueda de lugares con Photon y cálculo público de OSRM. Son adecuados para validación y uso ligero, pero deben sustituirse por servicios con capacidad contratada o infraestructura propia antes de una publicación con muchos usuarios.

Google Maps no garantiza más de tres puntos intermedios cuando el enlace se abre en un navegador móvil. La app avisa si la ruta supera ese límite.

Para navegación giro a giro dentro de Trackpi (sin abrir Google Maps), hace falta una aplicación nativa o un SDK comercial de navegación, credenciales, facturación y revisión específica para uso seguro en carretera.

## Avisos de velocidad y límites legales

En Francia la app no muestra coordenadas exactas de radares: agrupa las instalaciones fijas disponibles en OpenStreetMap dentro de zonas amplias de vigilancia. Las posibles ubicaciones móviles solo podrán incorporarse como zonas temporales mediante una fuente comunitaria verificada y con capacidad para atender órdenes oficiales de ocultación.

En España se muestran avisos de radares fijos basados en información publicada. Los controles móviles solo pueden tratarse como tramos publicados por las autoridades, nunca como detección en tiempo real. La consulta se agrupa, limita y guarda temporalmente para no saturar los servicios cartográficos.

En Suiza no se muestra ni anuncia ningún control fijo o móvil. La legislación suiza prohíbe las funciones GPS que avisan de controles de tráfico. Esta restricción no debe eliminarse al publicar la aplicación.

Los avisos son informativos, pueden estar incompletos y nunca sustituyen la señalización ni la obligación de respetar el límite de velocidad.
