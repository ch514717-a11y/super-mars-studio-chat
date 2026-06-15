FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /app/data
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
