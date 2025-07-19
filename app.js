const express = require('express');
const mysql = require('mysql2/promise'); // Updated to use promise-based API
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Create a connection pool
const pool = mysql.createPool({
    host: 'fw7wnc.h.filess.io',
    port: 3307,
    user: 'c237supermarket_deeplyload',
    password: 'f45d9d4fd3be1eda80a0dd8eb6b4ba79e8c1d53e',
    database: 'c237supermarket_deeplyload',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 10
});

// Test connection
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log('Connected to MySQL database');
        connection.release();
    } catch (err) {
        console.error('Error connecting to MySQL:', err);
    }
})();

// Set up view engine
app.set('view engine', 'ejs');

// Enable static files
app.use(express.static('public'));

// Enable form processing
app.use(express.urlencoded({
    extended: false
}));

// Session middleware
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // Session expires after 1 week
}));
app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;
    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }
    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/inventory', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products');
        res.render('inventory', { products: results, user: req.session.user });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send('Error fetching products');
    }
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, async (req, res) => {
    const { username, email, password, address, contact, role } = req.body;
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    try {
        await pool.query(sql, [username, email, password, address, contact, role]);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    } catch (err) {
        console.error('Registration error:', err);
        req.flash('error', 'An error occurred during registration.');
        res.redirect('/register');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }
    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    try {
        const [results] = await pool.query(sql, [email, password]);
        if (results.length > 0) {
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            if (req.session.user.role === 'user') {
                res.redirect('/shopping');
            } else {
                res.redirect('/inventory');
            }
        } else {
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).send('Internal server error');
    }
});

app.get('/shopping', checkAuthenticated, async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products');
        res.render('shopping', { user: req.session.user, products: results });
    } catch (error) {
        console.error('Database error:', error);
        res.status(500).send('Error fetching products');
    }
});

app.post('/add-to-cart/:id', checkAuthenticated, async (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;
    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]);
        if (results.length > 0) {
            const product = results[0];
            if (!req.session.cart) {
                req.session.cart = [];
            }
            const existingItem = req.session.cart.find(item => item.productId === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    productId: product.productId,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image
                });
            }
            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    } catch (error) {
        console.error('Cart error:', error);
        res.status(500).send('Error adding product to cart');
    }
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/product/:id', checkAuthenticated, async (req, res) => {
    const productId = req.params.id;
    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]);
        if (results.length > 0) {
            res.render('product', { product: results[0], user: req.session.user });
        } else {
            res.status(404).send('Product not found');
        }
    } catch (error) {
        console.error('Product error:', error);
        res.status(500).send('Error fetching product');
    }
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post('/addProduct', upload.single('image'), async (req, res) => {
    const { name, quantity, price } = req.body;
    let image = req.file ? req.file.filename : null;
    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    try {
        await pool.query(sql, [name, quantity, price, image]);
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).send('Error adding product');
    }
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, async (req, res) => {
    const productId = req.params.id;
    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]);
        if (results.length > 0) {
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    } catch (error) {
        console.error("Error fetching product:", error);
        res.status(500).send('Error fetching product');
    }
});

app.post('/updateProduct/:id', upload.single('image'), async (req, res) => {
    const productId = req.params.id;
    const { name, quantity, price, currentImage } = req.body;
    let image = currentImage;
    if (req.file) {
        image = req.file.filename;
    }
    const sql = 'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE productId = ?';
    try {
        await pool.query(sql, [name, quantity, price, image, productId]);
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).send('Error updating product');
    }
});

app.get('/deleteProduct/:id', async (req, res) => {
    const productId = req.params.id;
    try {
        await pool.query('DELETE FROM products WHERE productId = ?', [productId]);
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).send('Error deleting product');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));