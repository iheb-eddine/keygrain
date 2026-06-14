FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
COPY *.go ./
COPY VERSION ./
RUN CGO_ENABLED=0 go build -o keygrain-server .

FROM alpine:3.21
RUN apk --no-cache add ca-certificates && \
    adduser -D -H -s /sbin/nologin appuser
WORKDIR /app
COPY --from=builder /app/keygrain-server .
COPY static/ ./static/
RUN mkdir -p /app/data && chown -R appuser:appuser /app
USER appuser
ENV PORT=9860
EXPOSE 9860
CMD ["./keygrain-server"]
