/**
 * PDV SaaS - Backend Server
 * Sistema de Ponto de Venda Web
 * Versão: 1.0.0
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
const JWT_SECRET = process.env.JWT_SECRET || 'pdv-saas-secret-key-change-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Configuração de rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // limite por IP
    message: { error: 'Muitas requisições. Tente novamente mais tarde.' }
});

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    }
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api/', limiter);

// Servir arquivos estáticos
app.use(express.static('.'));

// Data directory
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SALES_FILE = path.join(DATA_DIR, 'sales.json');
const TENANTS_FILE = path.join(DATA_DIR, 'tenants.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Inicializar arquivos de dados
async function initializeDataFiles() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        
        const defaultData = {
            users: [{
                id: 1,
                email: "admin@pdv.com",
                password: await bcrypt.hash("admin123", 10),
                name: "Administrador",
                role: "admin",
                tenantId: 1,
                isActive: true,
                createdAt: new Date().toISOString()
            }],
            products: [{
                id: 1,
                tenantId: 1,
                barcode: "7891000142007",
                name: "Coca-Cola 2L",
                price: 9.99,
                cost: 6.50,
                stock: 50,
                category: "bebidas",
                lowStockAlert: 5,
                createdAt: new Date().toISOString()
            }, {
                id: 2,
                tenantId: 1,
                barcode: "7891910000197",
                name: "Arroz 5kg",
                price: 24.90,
                cost: 18.00,
                stock: 30,
                category: "alimentos",
                lowStockAlert: 10,
                createdAt: new Date().toISOString()
            }],
            sales: [],
            tenants: [{
                id: 1,
                name: "Loja Demo PDV SaaS",
                email: "contato@loja.com",
                cnpj: "12.345.678/0001-99",
                address: "Rua Exemplo, 123 - Centro",
                phone: "(11) 99999-9999",
                plan: "basic",
                subscriptionId: "sub_demo",
                subscriptionStatus: "active",
                monthlyPrice: 29.90,
                trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                createdAt: new Date().toISOString(),
                isActive: true
            }],
            settings: {
                companyName: "PDV Web SaaS",
                currency: "BRL",
                receiptFooter: "Obrigado pela preferência!\nVolte sempre!",
                taxRate: 0,
                printAutomatically: false,
                lowStockNotification: true
            }
        };

        // Criar arquivos se não existirem
        const files = [
            { file: USERS_FILE, data: defaultData.users },
            { file: PRODUCTS_FILE, data: defaultData.products },
            { file: SALES_FILE, data: defaultData.sales },
            { file: TENANTS_FILE, data: defaultData.tenants },
            { file: SETTINGS_FILE, data: defaultData.settings }
        ];

        for (const { file, data } of files) {
            try {
                await fs.access(file);
                console.log(`Arquivo existente: ${path.basename(file)}`);
            } catch {
                await fs.writeFile(file, JSON.stringify(data, null, 2));
                console.log(`Arquivo criado: ${path.basename(file)}`);
            }
        }

        console.log('✅ Arquivos de dados inicializados');
    } catch (error) {
        console.error('❌ Erro ao inicializar arquivos de dados:', error);
        throw error;
    }
}

// Middleware de autenticação
async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Token de acesso não fornecido' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
}

// Middleware de validação de tenant
async function validateTenant(req, res, next) {
    try {
        const tenants = JSON.parse(await fs.readFile(TENANTS_FILE, 'utf8'));
        const tenant = tenants.find(t => t.id === req.user.tenantId);
        
        if (!tenant || !tenant.isActive) {
            return res.status(403).json({ error: 'Conta inativa ou não encontrada' });
        }

        if (tenant.subscriptionStatus !== 'active' && new Date(tenant.trialEnds) < new Date()) {
            return res.status(403).json({ error: 'Assinatura expirada. Regularize para continuar.' });
        }

        req.tenant = tenant;
        next();
    } catch (error) {
        res.status(500).json({ error: 'Erro ao validar conta' });
    }
}

// Rotas de Autenticação
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
        }

        const users = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
        const user = users.find(u => u.email === email && u.isActive);

        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Credenciais inválidas' });
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const { password: _, ...userWithoutPassword } = user;
        
        res.json({
            success: true,
            user: userWithoutPassword,
            token,
            expiresIn: 24 * 60 * 60 // 24 horas em segundos
        });
    } catch (error) {
        console.error('Erro no login:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, name, storeName } = req.body;
        
        // Validação básica
        if (!email || !password || !name || !storeName) {
            return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
        }

        const users = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
        const tenants = JSON.parse(await fs.readFile(TENANTS_FILE, 'utf8'));
        
        // Verificar se email já existe
        if (users.some(u => u.email === email)) {
            return res.status(400).json({ error: 'E-mail já cadastrado' });
        }

        // Criar novo tenant
        const newTenantId = tenants.length > 0 ? Math.max(...tenants.map(t => t.id)) + 1 : 1;
        const newTenant = {
            id: newTenantId,
            name: storeName,
            email: email,
            plan: "trial",
            subscriptionStatus: "trial",
            monthlyPrice: 0,
            trialEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString(),
            isActive: true
        };

        tenants.push(newTenant);
        await fs.writeFile(TENANTS_FILE, JSON.stringify(tenants, null, 2));

        // Criar novo usuário
        const newUserId = users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = {
            id: newUserId,
            email,
            password: hashedPassword,
            name,
            role: "admin",
            tenantId: newTenantId,
            isActive: true,
            createdAt: new Date().toISOString()
        };

        users.push(newUser);
        await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));

        // Criar token
        const token = jwt.sign(
            { id: newUserId, email, role: "admin", tenantId: newTenantId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        const { password: _, ...userWithoutPassword } = newUser;
        
        res.status(201).json({
            success: true,
            message: 'Conta criada com sucesso!',
            user: userWithoutPassword,
            tenant: newTenant,
            token
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.status(500).json({ error: 'Erro ao criar conta' });
    }
});

// Rotas de Produtos
app.get('/api/products', authenticateToken, validateTenant, async (req, res) => {
    try {
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        const tenantProducts = products.filter(p => p.tenantId === req.user.tenantId);
        res.json(tenantProducts);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

app.get('/api/products/search', authenticateToken, validateTenant, async (req, res) => {
    try {
        const { q, barcode } = req.query;
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        const tenantProducts = products.filter(p => p.tenantId === req.user.tenantId);
        
        let result = tenantProducts;
        
        if (barcode) {
            result = result.filter(p => p.barcode === barcode);
        } else if (q) {
            const searchTerm = q.toLowerCase();
            result = result.filter(p => 
                p.name.toLowerCase().includes(searchTerm) ||
                p.barcode.includes(searchTerm)
            );
        }
        
        res.json(result.slice(0, 50)); // Limitar resultados
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar produtos' });
    }
});

app.post('/api/products', authenticateToken, validateTenant, async (req, res) => {
    try {
        const product = req.body;
        
        // Validação básica
        if (!product.name || !product.price || product.stock === undefined) {
            return res.status(400).json({ error: 'Nome, preço e estoque são obrigatórios' });
        }

        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        
        // Gerar ID único
        const newId = products.length > 0 ? Math.max(...products.map(p => p.id)) + 1 : 1;
        
        const newProduct = {
            id: newId,
            tenantId: req.user.tenantId,
            ...product,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        products.push(newProduct);
        await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        
        res.status(201).json({ success: true, product: newProduct });
    } catch (error) {
        console.error('Erro ao criar produto:', error);
        res.status(500).json({ error: 'Erro ao salvar produto' });
    }
});

app.put('/api/products/:id', authenticateToken, validateTenant, async (req, res) => {
    try {
        const productId = parseInt(req.params.id);
        const updates = req.body;
        
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        const index = products.findIndex(p => p.id === productId && p.tenantId === req.user.tenantId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Produto não encontrado' });
        }
        
        products[index] = {
            ...products[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        res.json({ success: true, product: products[index] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar produto' });
    }
});

// Rotas de Vendas
app.post('/api/sales', authenticateToken, validateTenant, async (req, res) => {
    try {
        const saleData = req.body;
        
        if (!saleData.items || !Array.isArray(saleData.items) || saleData.items.length === 0) {
            return res.status(400).json({ error: 'Itens da venda são obrigatórios' });
        }

        if (!saleData.paymentMethod) {
            return res.status(400).json({ error: 'Método de pagamento é obrigatório' });
        }

        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        
        // Gerar ID único para a venda
        const newSaleId = sales.length > 0 ? Math.max(...sales.map(s => s.id)) + 1 : 1;
        
        // Calcular total
        const total = saleData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Criar objeto da venda
        const newSale = {
            id: newSaleId,
            tenantId: req.user.tenantId,
            userId: req.user.id,
            items: saleData.items,
            total: total,
            paymentMethod: saleData.paymentMethod,
            cashReceived: saleData.cashReceived || null,
            cashChange: saleData.cashChange || null,
            status: 'completed',
            notes: saleData.notes || '',
            createdAt: new Date().toISOString()
        };

        // Atualizar estoque dos produtos
        for (const item of saleData.items) {
            const productIndex = products.findIndex(p => 
                p.id === item.productId && p.tenantId === req.user.tenantId
            );
            
            if (productIndex !== -1) {
                products[productIndex].stock -= item.quantity;
                products[productIndex].updatedAt = new Date().toISOString();
                
                if (products[productIndex].stock < 0) {
                    products[productIndex].stock = 0; // Prevenir estoque negativo
                }
            }
        }

        // Salvar dados
        sales.push(newSale);
        await fs.writeFile(SALES_FILE, JSON.stringify(sales, null, 2));
        await fs.writeFile(PRODUCTS_FILE, JSON.stringify(products, null, 2));
        
        res.status(201).json({ success: true, sale: newSale });
    } catch (error) {
        console.error('Erro ao registrar venda:', error);
        res.status(500).json({ error: 'Erro ao processar venda' });
    }
});

app.get('/api/sales/today', authenticateToken, validateTenant, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        
        const todaySales = sales.filter(s => 
            s.tenantId === req.user.tenantId && 
            s.createdAt.startsWith(today) &&
            s.status === 'completed'
        );
        
        res.json(todaySales);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar vendas do dia' });
    }
});

app.get('/api/sales/stats', authenticateToken, validateTenant, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        
        let filteredSales = sales.filter(s => s.tenantId === req.user.tenantId && s.status === 'completed');
        
        if (startDate) {
            filteredSales = filteredSales.filter(s => s.createdAt >= startDate);
        }
        
        if (endDate) {
            filteredSales = filteredSales.filter(s => s.createdAt <= endDate + 'T23:59:59.999Z');
        }
        
        const totalSales = filteredSales.length;
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);
        const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
        
        // Produtos mais vendidos
        const productSales = {};
        filteredSales.forEach(sale => {
            sale.items.forEach(item => {
                if (!productSales[item.productId]) {
                    productSales[item.productId] = {
                        productId: item.productId,
                        productName: item.productName || `Produto ${item.productId}`,
                        quantity: 0,
                        revenue: 0
                    };
                }
                productSales[item.productId].quantity += item.quantity;
                productSales[item.productId].revenue += item.price * item.quantity;
            });
        });
        
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 10);
        
        res.json({
            totalSales,
            totalRevenue,
            averageTicket,
            topProducts
        });
    } catch (error) {
        console.error('Erro ao buscar estatísticas:', error);
        res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
});

// Rotas do Dashboard
app.get('/api/dashboard/overview', authenticateToken, validateTenant, async (req, res) => {
    try {
        const sales = JSON.parse(await fs.readFile(SALES_FILE, 'utf8'));
        const products = JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8'));
        const today = new Date().toISOString().split('T')[0];
        
        const tenantSales = sales.filter(s => s.tenantId === req.user.tenantId && s.status === 'completed');
        const tenantProducts = products.filter(p => p.tenantId === req.user.tenantId);
        
        // Vendas de hoje
        const todaySales = tenantSales.filter(s => s.createdAt.startsWith(today));
        
        // Estatísticas
        const totalSales = todaySales.length;
        const totalRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
        const lowStockCount = tenantProducts.filter(p => p.stock < (p.lowStockAlert || 5)).length;
        const averageTicket = totalSales > 0 ? totalRevenue / totalSales : 0;
        
        // Vendas por método de pagamento
        const paymentMethods = {};
        todaySales.forEach(sale => {
            const method = sale.paymentMethod || 'unknown';
            paymentMethods[method] = (paymentMethods[method] || 0) + 1;
        });
        
        // Últimas vendas
        const recentSales = tenantSales
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10)
            .map(sale => ({
                id: sale.id,
                total: sale.total,
                paymentMethod: sale.paymentMethod,
                createdAt: sale.createdAt,
                itemsCount: sale.items.length
            }));
        
        res.json({
            totalSales,
            totalRevenue,
            lowStockCount,
            averageTicket,
            paymentMethods,
            recentSales
        });
    } catch (error) {
        console.error('Erro no dashboard:', error);
        res.status(500).json({ error: 'Erro ao carregar dashboard' });
    }
});

// Rotas de Configurações
app.get('/api/settings', authenticateToken, validateTenant, async (req, res) => {
    try {
        const tenants = JSON.parse(await fs.readFile(TENANTS_FILE, 'utf8'));
        const tenant = tenants.find(t => t.id === req.user.tenantId);
        
        if (!tenant) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
        
        res.json({
            tenant,
            systemSettings: settings
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao buscar configurações' });
    }
});

app.put('/api/settings/tenant', authenticateToken, validateTenant, async (req, res) => {
    try {
        const updates = req.body;
        const tenants = JSON.parse(await fs.readFile(TENANTS_FILE, 'utf8'));
        const index = tenants.findIndex(t => t.id === req.user.tenantId);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Conta não encontrada' });
        }
        
        tenants[index] = {
            ...tenants[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(TENANTS_FILE, JSON.stringify(tenants, null, 2));
        res.json({ success: true, tenant: tenants[index] });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao atualizar configurações' });
    }
});

// Rota de backup
app.get('/api/backup', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Acesso negado' });
        }
        
        const backupData = {
            users: JSON.parse(await fs.readFile(USERS_FILE, 'utf8')),
            products: JSON.parse(await fs.readFile(PRODUCTS_FILE, 'utf8')),
            sales: JSON.parse(await fs.readFile(SALES_FILE, 'utf8')),
            tenants: JSON.parse(await fs.readFile(TENANTS_FILE, 'utf8')),
            settings: JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8')),
            backupDate: new Date().toISOString()
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="pdv-backup.json"');
        res.json(backupData);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao criar backup' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'PDV SaaS API',
        version: '1.0.0',
        environment: NODE_ENV
    });
});

// Rota raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para o arquivo HTML principal
app.get('/pdv', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Middleware de tratamento de erros
app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    res.status(500).json({ 
        error: 'Erro interno do servidor',
        message: NODE_ENV === 'development' ? err.message : undefined
    });
});

// Inicializar e iniciar servidor
async function startServer() {
    try {
        await initializeDataFiles();
        
        app.listen(PORT, () => {
            console.log('='.repeat(60));
            console.log('🚀 PDV SaaS - Sistema de Ponto de Venda Web');
            console.log('='.repeat(60));
            console.log(`✅ Backend rodando em: http://localhost:${PORT}`);
            console.log(`📁 Frontend disponível em: http://localhost:${PORT}`);
            console.log(`🔧 API Health Check: http://localhost:${PORT}/api/health`);
            console.log(`🌐 Ambiente: ${NODE_ENV}`);
            console.log('='.repeat(60));
            console.log('\n📋 Credenciais de teste:');
            console.log('📧 E-mail: admin@pdv.com');
            console.log('🔑 Senha: admin123');
            console.log('='.repeat(60));
        });
    } catch (error) {
        console.error('❌ Falha ao iniciar servidor:', error);
        process.exit(1);
    }
}

// Iniciar servidor
if (require.main === module) {
    startServer();
}

module.exports = app;
