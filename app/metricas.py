"""Contadores simples para ver qué está pasando durante las pruebas."""
import threading
import time
from collections import Counter

_lock = threading.Lock()
_contadores = Counter()
_inicio = time.time()


def sumar(nombre, cantidad=1):
    with _lock:
        _contadores[nombre] += cantidad


def resumen():
    with _lock:
        datos = dict(_contadores)
    datos["segundos_activo"] = round(time.time() - _inicio)
    return datos


def reiniciar():
    global _inicio
    with _lock:
        _contadores.clear()
        _inicio = time.time()
