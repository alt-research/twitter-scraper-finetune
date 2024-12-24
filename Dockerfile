FROM node:lts

WORKDIR /app

COPY . .

RUN npm install

ENTRYPOINT ["npm", "run"]
