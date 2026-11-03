"""Limitador de peticiones por IP (ventana deslizante).

Un usuario real hace pocas peticiones; un bot que intenta acaparar entradas
hace muchas en poco tiempo. Si una IP supera LIMITE_PETICIONES dentro de
VENTANA_SEGUNDOS, recibe 429 (Too Many Requests).

En producción esto lo haría un WAF delante del servidor; aquí se implementa
en la propia aplicación para poder probarlo.
"""
import time
from collections import defaultdict, deque


class LimitadorPeticiones:
    def __init__(self, maximo, ventana_seg):
        self.maximo = maximo
        self.ventana = ventana_seg
        self._historial = defaultdict(deque)
        self._ultima_limpieza = time.monotonic()

    def permitir(self, clave):
        ahora = time.monotonic()
        marcas = self._historial[clave]
        while marcas and ahora - marcas[0] > self.ventana:
            marcas.popleft()

        if len(marcas) >= self.maximo:
            espera = self.ventana - (ahora - marcas[0])
            return False, max(1, round(espera))

        marcas.append(ahora)
        if ahora - self._ultima_limpieza > 60:
            self._limpiar(ahora)
        return True, 0

    def _limpiar(self, ahora):
        self._ultima_limpieza = ahora
        inactivas = [k for k, m in self._historial.items()
                     if not m or ahora - m[-1] > self.ventana]
        for k in inactivas:
            del self._historial[k]
