FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -o keygrain-server .

FROM alpine:3.21
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/keygrain-server .
COPY static/ ./static/
ENV PORT=9860
EXPOSE 9860
CMD ["./keygrain-server"]
