# Banco de pruebas de sincronización

Prueba en un navegador real que cambiar de cuenta de Google en el mismo dispositivo nunca mezcla
datos ni escribe en la nube de quien no es, y que sincronizar entre dispositivos no pierde nada
(móvil nuevo, cambios hechos sin cobertura, app abierta con datos de ayer, borrados). Usa la app tal cual se publica, pero con Firebase
sustituido por uno simulado (`fb/`) que apunta cada lectura y escritura.

```
npm run banco
```

Abre http://localhost:8770/ y pulsa «Ejecutar los escenarios» (algo más de un minuto). Tienen que
salir las 34 comprobaciones en verde.

Pásalo siempre que se toque `src/nube.js`, `src/cuenta.js`, `src/fusion.js`, `src/persistencia.js`,
`src/estado.js` o la sincronización y el arranque de `src/ui.js`. Se comprobó el 29/09/2026 que detecta el fallo: con la protección
de cambio de cuenta desactivada, marca 5 comprobaciones en rojo.

`app.html` y `estados.json` se generan al lanzarlo (no van en git). Las dos cuentas de prueba salen
de las nóminas de `test/fixtures`, sin datos personales.
