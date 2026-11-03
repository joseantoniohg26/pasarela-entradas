"""Sala de espera virtual.

Cada usuario recibe un número de turno al entrar. Cada medio segundo se deja
pasar a un grupo (SALA_ADMITIDOS_POR_SEG / 2). Al ser admitido, el usuario
recibe un "pase" firmado con HMAC que debe enviar para reservar y pagar.

Así la base de datos nunca recibe a todos los usuarios de golpe: la espera
ocurre aquí, en memoria, donde es barata.
"""
import asyncio
import hashlib
import hmac
import secrets
import time


class SalaEspera:
    def __init__(self, admitidos_por_seg, minutos_pase, secreto):
        self.admitidos_por_seg = admitidos_por_seg
        self.segundos_pase = minutos_pase * 60
        self._secreto = secreto.encode()
        self._turnos = {}          # ticket -> (numero de turno, hora de llegada)
        self._ultimo_turno = 0
        self._admitido_hasta = 0

    # --- pases firmados -------------------------------------------------

    def _firmar(self, texto):
        return hmac.new(self._secreto, texto.encode(), hashlib.sha256).hexdigest()[:32]

    def emitir_pase(self, ticket):
        expira = int(time.time()) + self.segundos_pase
        base = f"{ticket}.{expira}"
        return f"{base}.{self._firmar(base)}"

    def validar_pase(self, pase):
        """Devuelve el ticket si el pase es auténtico y no expiró, si no None."""
        try:
            ticket, expira, firma = pase.split(".")
            expira = int(expira)
        except (ValueError, AttributeError):
            return None
        if not hmac.compare_digest(firma, self._firmar(f"{ticket}.{expira}")):
            return None
        if expira < time.time():
            return None
        return ticket

    # --- cola -----------------------------------------------------------

    def entrar(self):
        self._ultimo_turno += 1
        ticket = secrets.token_urlsafe(12)
        self._turnos[ticket] = (self._ultimo_turno, time.time())
        return ticket, self._ultimo_turno - self._admitido_hasta

    def consultar(self, ticket):
        turno = self._turnos.get(ticket)
        if turno is None:
            return None
        numero, _ = turno
        if numero <= self._admitido_hasta:
            del self._turnos[ticket]
            return {"estado": "admitido", "pase": self.emitir_pase(ticket)}
        return {"estado": "esperando", "posicion": numero - self._admitido_hasta}

    def resumen(self):
        return {
            "en_cola": max(0, self._ultimo_turno - self._admitido_hasta),
            "total_llegadas": self._ultimo_turno,
            "admitidos": self._admitido_hasta,
            "admitidos_por_seg": self.admitidos_por_seg,
        }

    def _limpiar_abandonados(self):
        # quien fue admitido y nunca volvió a consultar, se descarta a los 30 min
        limite = time.time() - 1800
        viejos = [t for t, (_, llegada) in self._turnos.items() if llegada < limite]
        for t in viejos:
            del self._turnos[t]

    async def admitir_periodicamente(self):
        por_tanda = max(1, self.admitidos_por_seg // 2)
        vueltas = 0
        while True:
            await asyncio.sleep(0.5)
            self._admitido_hasta = min(self._ultimo_turno, self._admitido_hasta + por_tanda)
            vueltas += 1
            if vueltas % 600 == 0:
                self._limpiar_abandonados()
