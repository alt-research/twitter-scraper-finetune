FROM node:lts

WORKDIR /app

COPY . .

RUN npm install

RUN touch /app/.env 

ENTRYPOINT ["npm", "run"]
