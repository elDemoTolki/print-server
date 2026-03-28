const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Ingresa la contraseña para el administrador: ', async (password) => {
  try {
    const hash = await bcrypt.hash(password, 12);
    console.log('\nCopia este hash en tu archivo .env:');
    console.log(`ADMIN_PASSWORD=${hash}`);
  } catch (err) {
    console.error('Error generando hash:', err);
  } finally {
    rl.close();
  }
});
