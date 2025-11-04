// server.js o app.js

// 1. Importar módulos necesarios
const express = require('express');
const app = express();
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb'); // Importamos el driver y ObjectId
const port = 3000;

// ----------------------------------------------------------------------
// 2. CONEXIÓN A MONGODB (AJUSTA TU URL SI ES NECESARIO)
// ----------------------------------------------------------------------
const url = 'mongodb://127.0.0.1:27017'; // URL por defecto de MongoDB Compass/Server
const client = new MongoClient(url);
const masterDbName = 'sisclientes_master'; // Base de datos principal de MongoDB
const databasesCollectionName = 'databases'; // Colección para almacenar los nombres de las DBs simuladas

let db; // Objeto de la base de datos de MongoDB

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db(masterDbName);
        console.log("✅ Conexión a MongoDB establecida.");
        
        // Aseguramos que la colección maestra de "databases" exista
        await db.collection(databasesCollectionName).createIndex({ name: 1 }, { unique: true }).catch(() => {});
        
    } catch (err) {
        console.error("❌ Error conectando a MongoDB:", err);
        console.error("Asegúrate de que MongoDB Compass/Server esté corriendo en el puerto 27017.");
        // Si no se puede conectar, salimos del proceso de Node
        process.exit(1); 
    }
}

connectToMongo();

// 3. Variables Globales y Middlewares
let logged_in = true; 

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));
app.use(express.static(path.join(__dirname, 'static')));
app.use(express.urlencoded({ extended: true })); 
app.use(express.json());
app.use('/static', express.static('static'));

// ----------------------------------------------------------------------
//                        RUTAS CON LÓGICA DE MONGODB
// ----------------------------------------------------------------------

// Ruta: / (Página principal)
app.get('/', (req, res) => {
    res.render('index.ejs', { logged_in: logged_in });
});

// ----------------------------------------------------------------------
// RUTAS: GESTIÓN DE BASES DE DATOS (Colección 'databases')
// ----------------------------------------------------------------------

// RUTA GET: Listar Bases de Datos
app.get('/databases', async (req, res) => {
    try {
        // En lugar de SHOW DATABASES, leemos nuestra colección maestra
        const dbList = await db.collection(databasesCollectionName).find({}).toArray();
        
        // Mapeamos para que EJS vea la lista como si viniera de SQL
        const databases = dbList.map(doc => ({
            Database: doc.name, // Usamos el campo 'name' como nombre de la DB
        }));

        res.render('databases.ejs', { 
            logged_in: logged_in, 
            databases: databases,
            error: req.query.error 
        });
    } catch (error) {
        console.error('Error al listar bases de datos (Mongo):', error);
        res.status(500).send('Error interno del servidor.');
    }
});

// RUTA POST: Crear nueva Base de Datos
app.post('/create_database', async (req, res) => {
    const dbName = req.body.db_name;
    if (!dbName) {
        return res.redirect('/databases');
    }

    try {
        // Insertamos el nombre de la DB en la colección maestra.
        await db.collection(databasesCollectionName).insertOne({ name: dbName });
        res.redirect('/databases'); 
    } catch (error) {
        if (error.code === 11000) { // Error de índice duplicado (ya existe)
            return res.redirect(`/databases?error=${encodeURIComponent('La base de datos ya existe.')}`);
        }
        console.error(`Error al crear DB ${dbName} (Mongo):`, error);
        res.redirect(`/databases?error=${encodeURIComponent('Error al crear la base de datos.')}`);
    }
});

// RUTA POST: Eliminar una base de datos
app.post('/delete_database/:db_name', async (req, res) => {
    const dbName = req.params.db_name;
    try {
        // 1. Eliminar el documento de la lista maestra
        await db.collection(databasesCollectionName).deleteOne({ name: dbName });
        
        // 2. Eliminar la colección de datos real (la "tabla" simulada)
        await db.collection(dbName).drop().catch(() => {});
        
        res.redirect('/databases');
    } catch (error) {
        console.error(`Error al eliminar DB ${dbName} (Mongo):`, error);
        res.redirect(`/databases?error=${encodeURIComponent('Error al eliminar la base de datos.')}`);
    }
});

// ----------------------------------------------------------------------
// RUTAS: GESTIÓN DE TABLAS (Colecciones de Datos)
// ----------------------------------------------------------------------

// RUTA GET: Mostrar Tablas/Colecciones (Muestra la vista tables.ejs)
app.get('/databases/:db_name', async (req, res) => {
    const dbName = req.params.db_name;
    
    // Verificamos si la colección de datos existe para mostrarla en la lista
    const collections = await db.listCollections({ name: dbName }).toArray();
    
    // Si la colección de datos existe, la mostramos como una "tabla" en EJS
    const tables = collections.length > 0 ? 
        [{ [`Tables_in_${dbName}`]: dbName }] : 
        []; 

    res.render('tables.ejs', {
        logged_in: logged_in,
        db_name: dbName,
        tables: tables, // Lista de "tablas" simuladas
        error: req.query.error_table // Pasar errores
    });
});


// RUTA POST: Crear Nueva Tabla (Insertar primer documento con estructura)
app.post('/databases/:db_name/create_table', async (req, res) => {
    const dbName = req.params.db_name;
    
    // Eliminamos la lectura de req.body.table_name y simplificamos:
    const { num_columns } = req.body; 
    const numCols = parseInt(num_columns, 10);
    
    let newDocument = {};

    // 1. Construir el documento de ejemplo
    for (let i = 0; i < numCols; i++) {
        const name = req.body[`column_name_${i}`];
        // En MongoDB, los "tipos" de datos son flexibles, solo necesitamos el nombre del campo (key).
        if (name) {
            newDocument[name] = null; // Asignamos null como valor inicial
        }
    }
    
    try {
        if (Object.keys(newDocument).length > 0) {
            // 2. Insertar el documento en la colección con el nombre de la DB
            await db.collection(dbName).insertOne(newDocument);
        }
        res.redirect(`/databases/${dbName}`); 
    } catch (error) {
        console.error(`Error al crear colección/documento en ${dbName} (Mongo):`, error);
        res.redirect(`/databases/${dbName}?error_table=${encodeURIComponent('Error al crear la estructura de la colección.')}`);
    }
});


// RUTA POST: Eliminar una tabla (Eliminar la colección asociada a la DB simulada)
app.post('/delete_table/:db_name/:table_name', async (req, res) => {
    const { db_name } = req.params; // Usamos db_name como nombre de la colección
    
    try {
        await db.collection(db_name).drop();
        res.redirect(`/databases/${db_name}`);
    } catch (error) {
        console.error(`Error al eliminar colección ${db_name} (Mongo):`, error);
        res.redirect(`/databases/${db_name}?error_table=${encodeURIComponent('Error al eliminar la colección.')}`);
    }
});


// ----------------------------------------------------------------------
// RUTAS: GESTIÓN DE DATOS (CRUD de Documentos)
// ----------------------------------------------------------------------

// RUTA GET: Mostrar datos de una tabla (Mostrar documentos de la colección)
app.get('/databases/:db_name/:table_name', async (req, res) => {
    const { db_name } = req.params; // Usamos db_name como nombre de la colección
    
    try {
        const records = await db.collection(db_name).find({}).toArray();
        
        // Extraer nombres de columna (campos) del primer registro para el encabezado
        const columns = records.length > 0 ? 
            Object.keys(records[0]).filter(key => key !== '_id') : 
            []; // Si no hay registros, no hay columnas

        // Mapear los registros para que EJS pueda renderizarlos por índice
        const mappedRecords = records.map(doc => {
            // Convertir el documento a un array de valores, incluyendo el _id
            const values = columns.map(col => doc[col] !== undefined ? doc[col] : '');
            return [doc._id.toHexString(), ...values]; // Añadimos el _id como primer elemento
        });
        
        res.render('show_data.ejs', {
            logged_in: logged_in,
            db_name: db_name,
            table_name: db_name, // Usamos db_name como nombre de la tabla
            columns: ['_id', ...columns], // Agregamos _id al inicio de las columnas
            records: mappedRecords
        });
    } catch (error) {
        console.error(`Error al mostrar datos de ${db_name} (Mongo):`, error);
        res.status(500).send('Error al obtener datos de la colección.');
    }
});

// RUTA GET: Cargar formulario para editar un documento/registro
app.get('/databases/:db_name/:table_name/edit_data/:id', async (req, res) => {
    const { db_name, id } = req.params;
    
    try {
        // 1. Encontrar el documento por su _id
        const document = await db.collection(db_name).findOne({ _id: new ObjectId(id) });

        if (!document) {
            return res.status(404).send('Documento no encontrado.');
        }

        // 2. Extraer los nombres de columna (keys)
        const columns = Object.keys(document).filter(key => key !== '_id');

        // 3. Renderizar el formulario de edición
        res.render('edit_data.ejs', {
            logged_in: true,
            db_name: db_name,
            table_name: db_name,
            record: document, // El documento completo
            columns: columns  // Las claves para generar los inputs
        });
    } catch (error) {
        console.error(`Error al cargar datos para editar el documento ${id}:`, error);
        res.status(500).send('Error al cargar la información del documento.');
    }
});

// RUTA POST: Guardar los cambios del documento/registro
// server.js

// RUTA POST: Guardar los cambios del documento/registro (¡CORREGIDA!)
app.post('/databases/:db_name/:table_name/edit_data/:id', async (req, res) => {
    const { db_name, table_name, id } = req.params;
    
    // 1. Clonar el cuerpo de la solicitud (req.body)
    const updateData = { ...req.body };

    // 2. ¡EXCLUIR EXPLÍCITAMENTE EL CAMPO _id!
    // No podemos actualizar el _id, así que lo eliminamos del objeto de datos a actualizar.
    delete updateData._id; 

    // Opcional: Si tienes el campo 'id' en req.body por error, elimínalo también.
    // delete updateData.id; 

    try {
        // 3. Actualizar el documento por _id
        await db.collection(db_name).updateOne(
            { _id: new ObjectId(id) }, // Filtro: Usa el ID de la URL
            { $set: updateData }       // Datos: No incluye el campo _id
        );

        // 4. Redirigir a la vista de datos
        res.redirect(`/databases/${db_name}/${table_name}`);
    } catch (error) {
        console.error(`Error al actualizar el documento ${id}:`, error);
        res.status(500).send(`Error al guardar los cambios en el documento: ${error.errmsg || error.message}`);
    }
});

// RUTA POST: Eliminar un registro/documento
app.post('/databases/:db_name/:table_name/delete_data/:id', async (req, res) => {
    const { db_name, table_name, id } = req.params;
    
    try {
        // 1. Eliminar el documento por _id
        await db.collection(db_name).deleteOne({ _id: new ObjectId(id) });

        // 2. Redirigir a la vista de datos
        res.redirect(`/databases/${db_name}/${table_name}`);
    } catch (error) {
        console.error(`Error al eliminar el documento ${id}:`, error);
        res.status(500).send('Error al eliminar el documento.');
    }
});

app.get('/databases/:db_name/:table_name/add_data', async (req, res) => {
    const { db_name } = req.params;
    
    try {
        // 1. Obtener el primer documento para determinar la estructura de la tabla (columnas)
        const sampleDocument = await db.collection(db_name).findOne({});

        // 2. Extraer los nombres de columna/campo, excluyendo _id
        let columns = [];
        if (sampleDocument) {
            columns = Object.keys(sampleDocument).filter(key => key !== '_id');
        }

        // 3. Renderizar el formulario de adición
        res.render('add_data.ejs', {
            logged_in: true,
            db_name: db_name,
            table_name: db_name,
            columns: columns  // Las claves para generar los inputs
        });
    } catch (error) {
        console.error(`Error al cargar formulario para agregar datos en ${db_name}:`, error);
        res.status(500).send('Error al obtener la estructura de la colección.');
    }
});

// RUTA POST: Insertar un nuevo documento/registro
app.post('/databases/:db_name/:table_name/add_data', async (req, res) => {
    const { db_name, table_name } = req.params;
    
    // El cuerpo de la solicitud (req.body) ya es el nuevo documento
    const newDocument = req.body; 

    try {
        // 1. Insertar el nuevo documento
        await db.collection(db_name).insertOne(newDocument);

        // 2. Redirigir a la vista de datos
        res.redirect(`/databases/${db_name}/${table_name}`);
    } catch (error) {
        console.error(`Error al insertar nuevo documento en ${db_name}:`, error);
        res.status(500).send(`Error al guardar el nuevo registro: ${error.message}`);
    }
});

app.get('/manual', (req, res) => {
    // Redirige al archivo estático dentro de la carpeta 'static'
    res.redirect('/static/Manual_de_Usuario.pdf');
});


// RUTA GET: Muestra la página de contactos/desarrolladores

app.get('/contacts', (req, res) => {
    // Lista de programadores adaptada a las claves de la plantilla (image_url, name, role, email)
    const programmers = [
        {
            name: "Diego Aaron Garcia Casillas",
            role: "Líder de Proyecto / Backend",
            phone: "427 102 7967", 
            email: "diegoagc.ti24@utsj.edu.mx",
            // Asegúrate de que esta ruta sea correcta. El archivo debe estar en /static
            image_url: "/static/programador1.jpeg" 
        },
        {
            name: "Eduardo Gomez Escobar",
            role: "Desarrollador Frontend",
            phone: "442-987-6543", 
            email: "programador2@utsj.edu.mx",
            // Asegúrate de que esta ruta sea correcta. El archivo debe estar en /static
            image_url: "/static/programador2.jpeg" 
        },
        {
            name: "Luis Angel Lopez Escobar",
            role: "Desarrollador Frontend",
            phone: "442-987-6543", 
            email: "programador2@utsj.edu.mx",
            // Asegúrate de que esta ruta sea correcta. El archivo debe estar en /static
            image_url: "/static/programador3.jpeg" 
        },
        // Puedes agregar más objetos aquí...
    ];

    // Renderiza la plantilla contacts.ejs (la versión actualizada y robusta)
    res.render('contacts.ejs', { 
        logged_in: true,
        programmers: programmers 
    });
});

// *********** INICIO DEL SERVIDOR ***********
app.listen(port, () => {
    console.log(`Servidor Express/EJS corriendo en http://localhost:${port}`);
});