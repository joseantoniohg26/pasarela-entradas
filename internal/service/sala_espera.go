package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

type SalaEspera struct {
	admitidosPorSeg int
	segundosPase    int64
	secreto         []byte

	mu            sync.Mutex
	turnos        map[string]turnoInfo
	ultimoTurno   int64
	admitidoHasta int64
}

type turnoInfo struct {
	numero  int64
	llegada int64
}

type EstadoSala struct {
	Estado   string  `json:"estado"`
	Posicion *int64  `json:"posicion,omitempty"`
	Pase     *string `json:"pase,omitempty"`
}

type ResumenSala struct {
	EnCola          int64 `json:"en_cola"`
	TotalLlegadas   int64 `json:"total_llegadas"`
	Admitidos       int64 `json:"admitidos"`
	AdmitidosPorSeg int   `json:"admitidos_por_seg"`
}

func NuevaSalaEspera(admitidosPorSeg, minutosPase int, secreto string) *SalaEspera {
	return &SalaEspera{
		admitidosPorSeg: admitidosPorSeg,
		segundosPase:    int64(minutosPase * 60),
		secreto:         []byte(secreto),
		turnos:          make(map[string]turnoInfo),
	}
}

func (s *SalaEspera) IniciarAdmitidor(stop <-chan struct{}) {
	intervalo := 500 * time.Millisecond
	ticker := time.NewTicker(intervalo)
	defer ticker.Stop()

	lote := int64(s.admitidosPorSeg / 2)
	if lote < 1 {
		lote = 1
	}

	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.mu.Lock()
			if s.admitidoHasta < s.ultimoTurno {
				s.admitidoHasta += lote
				if s.admitidoHasta > s.ultimoTurno {
					s.admitidoHasta = s.ultimoTurno
				}
			}
			s.limpiarAbandonados()
			s.mu.Unlock()
		}
	}
}

func (s *SalaEspera) firmar(base string) string {
	mac := hmac.New(sha256.New, s.secreto)
	mac.Write([]byte(base))
	return hex.EncodeToString(mac.Sum(nil))[:32]
}

func (s *SalaEspera) EmitirPase(ticket string) string {
	expira := time.Now().Unix() + s.segundosPase
	base := fmt.Sprintf("%s.%d", ticket, expira)
	return fmt.Sprintf("%s.%s", base, s.firmar(base))
}

func (s *SalaEspera) ValidarPase(pase string) string {
	partes := strings.Split(pase, ".")
	if len(partes) != 3 {
		return ""
	}
	ticket := partes[0]
	expiraStr := partes[1]
	firma := partes[2]

	expira, err := strconv.ParseInt(expiraStr, 10, 64)
	if err != nil {
		return ""
	}

	esperada := s.firmar(fmt.Sprintf("%s.%s", ticket, expiraStr))
	if !hmac.Equal([]byte(firma), []byte(esperada)) {
		return ""
	}
	if expira < time.Now().Unix() {
		return ""
	}
	return ticket
}

func (s *SalaEspera) Entrar() (string, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.ultimoTurno++
	b := make([]byte, 9)
	_, _ = rand.Read(b)
	ticket := hex.EncodeToString(b)

	ahora := time.Now().Unix()
	s.turnos[ticket] = turnoInfo{numero: s.ultimoTurno, llegada: ahora}

	posicion := s.ultimoTurno - s.admitidoHasta
	if posicion < 0 {
		posicion = 0
	}
	return ticket, posicion
}

func (s *SalaEspera) Consultar(ticket string) *EstadoSala {
	s.mu.Lock()
	defer s.mu.Unlock()

	info, existe := s.turnos[ticket]
	if !existe {
		return nil
	}

	if info.numero <= s.admitidoHasta {
		delete(s.turnos, ticket)
		pase := s.EmitirPase(ticket)
		return &EstadoSala{
			Estado: "admitido",
			Pase:   &pase,
		}
	}

	pos := info.numero - s.admitidoHasta
	return &EstadoSala{
		Estado:   "esperando",
		Posicion: &pos,
	}
}

func (s *SalaEspera) Resumen() ResumenSala {
	s.mu.Lock()
	defer s.mu.Unlock()

	enCola := s.ultimoTurno - s.admitidoHasta
	if enCola < 0 {
		enCola = 0
	}

	return ResumenSala{
		EnCola:          enCola,
		TotalLlegadas:   s.ultimoTurno,
		Admitidos:       s.admitidoHasta,
		AdmitidosPorSeg: s.admitidosPorSeg,
	}
}

func (s *SalaEspera) limpiarAbandonados() {
	limite := time.Now().Unix() - 1800
	for t, info := range s.turnos {
		if info.llegada < limite {
			delete(s.turnos, t)
		}
	}
}

