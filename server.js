const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SALES_FILE = path.join(DATA_DIR, 'sales.json');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');

// Ensure data directory exists
async function initDataFiles() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        const defaultData = {
            users: [
                {
                    id: 1,
                    email: "admin@pdv.com",
                    password: "$2b$10$K7Vv7/3QNQY6q3q2q2q2q2", // senha: admin123
                    name: "Administrador",
                    role: "admin",
                    tenantId: 1
                }
            ],
            products: [],
            sales: [],
            tenants: [
                {
                    id: 1,
                    name: "Loja Demo",
                    plan: "basic",
                    status: "active",
                    trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                }
            ]
        };

        // Initialize files if they don't exist
        try {
            await fs.access(USERS_FILE);
        } catch {
            await fs.writeFile(USERS_FILE, JSON.stringify(defaultData.users, null, 2));
        }

        try {
            await fs.access(PRODUCTS_FILE);
        } catch {
            await fs.writeFile(PRODUCTS_FILE, JSON.stringify(defaultData.products, null, 2));
        }

        try {
            await fs.access(SALES_FILE);
        } catch {
            await fs.writeFile(SALES_FILE, JSON.stringify(defaultData.sales, null, 2));
        }

        try {
            await fs.access(TENANTS_FILE);
        } catch {
            await fs.writeFile(TENANTS_FILE, JSON.stringify(defaultData.tenants, null, 2));
        }

        console.log('Data files initialized');
    } catch (error) {
        console.error('Error initializing data files:', error);
    }
}

// API Routes

// Authentication
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const users = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
        
        const user = users.find(u => u.email === email);
        
        if (user && user.password === password) {
            // In production, use bcrypt for password hashing
            const { password, ...userWithoutPassword } = user;
            res.json({
                success: true,
                user: userWithoutPassword,
                token: 'mock-jwt-token-' + Date.now()
            });
        } else {
            res.status(401).json({ success: false, message: 'Credenciais inválidas' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Erro no servidor' });
    }
});

// Products
app.get('/api/products/:tenantId', async (req, res) => {
    try {
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        const tenantProducts = products.filter(p => p.tenantId == req.params.tenantId);
        res.json(tenantProducts);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

app.post('/api/products', async (req, res) => {
    try {
        const product = req.body;
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        
        product.id = Date.now();
        products.push(product);
        
        await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        res.json({ success: true, product });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar produto' });
    }
});

// Sales
app.post('/api/sales', async (req, res) => {
    try {
        const sale = req.body;
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        
        sale.id = Date.now();
        sale.date = new Date().toISOString();
        sales.push(sale);
        
        await fs.writeFile(SALES_FILE, JSON.stringify(sales, null, 2));
        res.json({ success: true, sale });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao registrar venda' });
    }
});

app.get('/api/sales/:tenantId/today', async (req, res) => {
    try {
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        const today = new Date().toISOString().split('T')[0];
        
        const todaySales = sales.filter(s => 
            s.tenantId == req.params.tenantId && 
            s.date.startsWith(today)
        );
        
        res.json(todaySales);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar vendas' });
    }
});

// Dashboard Stats
app.get('/api/dashboard/:tenantId', async (req, res) => {
    try {
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        
        const tenantId = req.params.tenantId;
        const today = new Date().toISOString().split('T')[0];
        
        const tenantSales = sales.filter(s => s.tenantId == tenantId && s.date.startsWith(today));
        const tenantProducts = products.filter(p => p.tenantId == tenantId);
        
        const totalSales = tenantSales.length;
        const totalRevenue = tenantSales.reduce((sum, sale) => sum + sale.total, 0);
        const lowStockCount = tenantProducts.filter(p => p.stock < (p.lowStockAlert || 5)).length;
        
        res.json({
            totalSales,
            totalRevenue,
            lowStockCount,
            averageTicket: totalSales > 0 ? totalRevenue / totalSales : 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve the HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pdv-saas.html'));
});

// Start server
async function startServer() {
    await initDataFiles();
    
    app.listen(PORT, () => {
        console.log(`✅ PDV SaaS Server running on http://localhost:${PORT}`);
        console.log(`📁 Frontend: http://localhost:${PORT}/pdv-saas.html`);
        console.log(`🔧 API: http://localhost:${PORT}/api`);
    });
}

startServer();
