// src/types/compra.ts

export interface AsientoBackend {
  id: number;
  fila: string;
  numero: number;
  precio: number;
  estado: "libre" | "reservado" | "vendido";
  mio?: boolean;
  reservado_hasta?: string;
}

export interface ReservaActiva {
  id: number;
  etiqueta: string;
  precio: number;
  hasta: Date;
}

export interface EntradaGenerada {
  codigo: string;
  evento: string;
  lugar: string;
  fecha: string;
  zona: string;
  asiento: string;
  comprador: string;
  monto: number;
  tarjeta_ultimos4: string;
  qr?: string;
  qr_svg?: string;
  qr_texto?: string;
  usado_en?: string | null;
}

