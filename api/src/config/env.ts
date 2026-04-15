const env = {
    PORT: parseInt(process.env.PORT || "3001", 10),
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/kanban",
    CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
    NODE_ENV: process.env.NODE_ENV || "development",
};

export default env;
