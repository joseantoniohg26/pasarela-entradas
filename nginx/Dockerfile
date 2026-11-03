FROM nginx:alpine

RUN apk add --no-cache openssl

# Crear certificados autofirmados con SAN para localhost e IPs
RUN mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/certs/clave.pem \
    -out /etc/nginx/certs/certificado.pem \
    -subj "/C=PE/ST=Madre de Dios/L=Puerto Maldonado/O=Tiquetera UNAMAD/CN=tiquetera.local" \
    -addext "subjectAltName=DNS:localhost,DNS:tiquetera.local,IP:127.0.0.1,IP:10.0.2.2,IP:64.177.58.232"

COPY nginx/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80 443 8000 8443

CMD ["nginx", "-g", "daemon off;"]

