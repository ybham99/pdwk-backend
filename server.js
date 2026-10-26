const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // Agar backend bisa menerima data JSON dari React

// Konfigurasi koneksi database 
const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Tes koneksi database
db.getConnection((err, connection) => {
  if (err) {
    console.error('Gagal terhubung ke MySQL:', err.message);
  } else {
    console.log('Berhasil terhubung ke database MySQL pendataan_warga!');
    connection.release();
  }
});

// Route dasar untuk tes API
app.get('/api/test', (req, res) => {
  res.json({ message: 'API Backend berjalan dengan baik!' });
});

const bcrypt = require('bcrypt');

// --- (Opsional) Route sementara untuk membuat akun tes ---
app.get('/api/seed-user', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash('123456', 10);
    const query = `INSERT INTO users (identitas, password_hash, role) VALUES (?, ?, ?)`;
    
    // Membuat 1 akun warga dan 1 akun rw
    db.query(query, ['08123456789', hashedPassword, 'warga']);
    db.query(query, ['adminrw', hashedPassword, 'rw']);
    
    res.json({ message: 'Data pengguna tes berhasil ditambahkan! Passwordnya: 123456' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Endpoint Registrasi Warga ---
app.post('/api/register', async (req, res) => {
  const { nama_lengkap, identitas, password } = req.body;

  try {
    const checkQuery = 'SELECT * FROM users WHERE identitas = ?';
    db.query(checkQuery, [identitas], async (err, results) => {
      if (err) return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
      
      if (results.length > 0) {
        return res.status(400).json({ message: 'Identitas sudah terdaftar!' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const insertQuery = 'INSERT INTO users (identitas, nama_lengkap, password_hash, role) VALUES (?, ?, ?, ?)';
      db.query(insertQuery, [identitas, nama_lengkap, hashedPassword, 'warga'], (err) => {
        if (err) return res.status(500).json({ message: 'Gagal mendaftarkan akun' });
        res.status(201).json({ message: 'Registrasi berhasil! Silakan login.' });
      });
    });
  } catch (error) {
    res.status(500).json({ message: 'Terjadi kesalahan sistem' });
  }
});

// --- Endpoint Login ---
app.post('/api/login', (req, res) => {
  const { identitas, password } = req.body;

  const query = 'SELECT * FROM users WHERE identitas = ?';
  db.query(query, [identitas], async (err, results) => {
    if (err) return res.status(500).json({ message: 'Terjadi kesalahan pada server' });
    if (results.length === 0) return res.status(401).json({ message: 'Identitas tidak ditemukan' });

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!isMatch) return res.status(401).json({ message: 'Password salah' });

    res.json({ 
      message: 'Login berhasil', 
      user: {
        id: user.id_user,
        identitas: user.identitas,
        nama: user.nama_lengkap,
        role: user.role
      } 
    });
  });
});

// --- Endpoint Ambil Data Profil Keluarga ---
app.get('/api/profil/:id_user', (req, res) => {
  const { id_user } = req.params;

  const queryKK = 'SELECT * FROM kartu_keluarga WHERE id_user = ?';
  
  db.query(queryKK, [id_user], (err, resultsKK) => {
    if (err) return res.status(500).json({ error: err.message });
    
    if (resultsKK.length === 0) {
      return res.json({ kk: null, anggota: [] });
    }

    const dataKK = resultsKK[0];

    const queryAnggota = 'SELECT * FROM anggota_keluarga WHERE id_kk = ?';
    db.query(queryAnggota, [dataKK.id_kk], (err, resultsAnggota) => {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({
        kk: dataKK,
        anggota: resultsAnggota
      });
    });
  });
});

// --- Endpoint Simpan/Perbarui Data Keluarga ---
app.post('/api/simpan-data-keluarga', (req, res) => {
  const { id_user, no_kk, alamat, rt, rw, anggota } = req.body;

  db.query('SELECT id_kk FROM kartu_keluarga WHERE id_user = ?', [id_user], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    if (results.length > 0) {
      const id_kk = results[0].id_kk;
      const updateKK = 'UPDATE kartu_keluarga SET no_kk=?, alamat=?, rt=?, rw=?, status_pendataan="menunggu_verifikasi" WHERE id_kk=?';
      
      db.query(updateKK, [no_kk, alamat, rt, rw, id_kk], (err) => {
        if (err) return res.status(500).json({ error: err.message });

        db.query('DELETE FROM anggota_keluarga WHERE id_kk=?', [id_kk], (err) => {
          if (err) return res.status(500).json({ error: err.message });

          const queryAnggota = 'INSERT INTO anggota_keluarga (id_kk, nik, nama_lengkap, jenis_kelamin, tanggal_lahir, hubungan_keluarga, pendidikan, pekerjaan, no_telepon) VALUES ?';
          const values = anggota.map(a => [id_kk, a.nik, a.nama, a.jk, a.tgl_lahir || null, a.hubungan, a.pendidikan, a.pekerjaan, a.no_telepon || '']);

          db.query(queryAnggota, [values], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'Data keluarga berhasil diperbarui!' });
          });
        });
      });
    } else {
      const insertKK = 'INSERT INTO kartu_keluarga (id_user, no_kk, alamat, rt, rw, status_pendataan) VALUES (?, ?, ?, ?, ?, "menunggu_verifikasi")';
      
      db.query(insertKK, [id_user, no_kk, alamat, rt, rw], (err, resultKK) => {
        if (err) return res.status(500).json({ error: err.message });
        
        const id_kk = resultKK.insertId;
        const queryAnggota = 'INSERT INTO anggota_keluarga (id_kk, nik, nama_lengkap, jenis_kelamin, tanggal_lahir, hubungan_keluarga, pendidikan, pekerjaan, no_telepon) VALUES ?';
        const values = anggota.map(a => [id_kk, a.nik, a.nama, a.jk, a.tgl_lahir || null, a.hubungan, a.pendidikan, a.pekerjaan, a.no_telepon || '']);

        db.query(queryAnggota, [values], (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: 'Data keluarga baru berhasil disimpan!' });
        });
      });
    }
  });
});

// --- Endpoint Ambil Daftar Menunggu Verifikasi (DIPERBAIKI) ---
app.get('/api/verifikasi', (req, res) => {
  const query = `
    SELECT k.id_kk, k.no_kk, 
           (SELECT nama_lengkap FROM anggota_keluarga WHERE id_kk = k.id_kk LIMIT 1) AS kepala
    FROM kartu_keluarga k
    WHERE k.status_pendataan = 'menunggu_verifikasi'
  `;
  
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// --- Endpoint Proses Persetujuan/Penolakan ---
app.post('/api/verifikasi/:id_kk', (req, res) => {
  const { id_kk } = req.params;
  const { status_baru } = req.body; 

  const query = 'UPDATE kartu_keluarga SET status_pendataan = ? WHERE id_kk = ?';
  db.query(query, [status_baru, id_kk], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Status berhasil diperbarui' });
  });
});

// --- Endpoint Ambil Statistik Dashboard Pengurus ---
// --- Endpoint Ambil Statistik Dashboard Pengurus (DIPERBAIKI) ---
app.get('/api/statistik', (req, res) => {
  const query = `
    SELECT 
      (SELECT COUNT(id_kk) FROM kartu_keluarga) AS total_kk,
      (SELECT COUNT(id_kk) FROM kartu_keluarga WHERE status_pendataan = 'disetujui') AS sudah_mengisi,
      (SELECT COUNT(id_kk) FROM kartu_keluarga WHERE status_pendataan = 'menunggu_verifikasi') AS menunggu,
      (SELECT COUNT(id_kk) FROM kartu_keluarga WHERE status_pendataan = 'perlu_diperbaiki') AS perlu_diperbaiki,
      (SELECT COUNT(id_user) FROM users WHERE role = 'warga' AND id_user NOT IN (SELECT id_user FROM kartu_keluarga)) AS belum_mengisi
  `;
  
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Memberikan nilai default 0 jika data kosong agar aman
    const data = results[0] || {};
    
    res.json({
      total_kk: Number(data.total_kk) || 0,
      sudah_mengisi: Number(data.sudah_mengisi) || 0,
      menunggu: Number(data.menunggu) || 0,
      belum_mengisi: Number(data.belum_mengisi) || 0,
      perlu_diperbaiki: Number(data.perlu_diperbaiki) || 0
    });
  });
});

// --- Endpoint Ambil Semua Daftar Warga (DIPERBAIKI) ---
app.get('/api/warga', (req, res) => {
  const query = `
    SELECT k.no_kk, k.rt, k.rw, k.status_pendataan,
           (SELECT nama_lengkap FROM anggota_keluarga WHERE id_kk = k.id_kk LIMIT 1) AS kepala
    FROM kartu_keluarga k
    ORDER BY k.rt ASC, k.rw ASC
  `;
  
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// --- Endpoint Hapus Data Warga ---
app.delete('/api/warga/:no_kk', (req, res) => {
  const { no_kk } = req.params;

  db.query('SELECT id_kk FROM kartu_keluarga WHERE no_kk = ?', [no_kk], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ message: 'Data tidak ditemukan' });

    const id_kk = results[0].id_kk;

    db.query('DELETE FROM anggota_keluarga WHERE id_kk = ?', [id_kk], (err) => {
      if (err) return res.status(500).json({ error: err.message });

      db.query('DELETE FROM kartu_keluarga WHERE id_kk = ?', [id_kk], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Data warga beserta anggota keluarganya berhasil dihapus!' });
      });
    });
  });
});

// --- Endpoint Ambil Detail Warga ---
app.get('/api/warga/:no_kk/detail', (req, res) => {
  const { no_kk } = req.params;

  db.query('SELECT * FROM kartu_keluarga WHERE no_kk = ?', [no_kk], (err, kkResults) => {
    if (err) return res.status(500).json({ error: err.message });
    if (kkResults.length === 0) return res.status(404).json({ message: 'Data KK tidak ditemukan' });

    const dataKK = kkResults[0];

    db.query('SELECT * FROM anggota_keluarga WHERE id_kk = ?', [dataKK.id_kk], (err, anggotaResults) => {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({
        kk: dataKK,
        anggota: anggotaResults
      });
    });
  });
});

// ==========================================
// FITUR PENGADUAN WARGA
// ==========================================

// 1. Endpoint: Warga mengirim pengaduan baru
app.post('/api/pengaduan', (req, res) => {
  const { id_user, judul, kategori, deskripsi } = req.body;
  
  const query = 'INSERT INTO pengaduan (id_user, judul, kategori, deskripsi) VALUES (?, ?, ?, ?)';
  db.query(query, [id_user, judul, kategori, deskripsi], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ message: 'Pengaduan berhasil dikirim!' });
  });
});

// 2. Endpoint: Menampilkan riwayat pengaduan milik satu warga
app.get('/api/pengaduan/warga/:id_user', (req, res) => {
  const { id_user } = req.params;
  
  const query = 'SELECT * FROM pengaduan WHERE id_user = ? ORDER BY tanggal_dibuat DESC';
  db.query(query, [id_user], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 3. Endpoint: Pengurus melihat SEMUA pengaduan masuk
app.get('/api/pengaduan', (req, res) => {
  const query = `
    SELECT p.*, u.nama_lengkap as nama_warga 
    FROM pengaduan p
    JOIN users u ON p.id_user = u.id_user
    ORDER BY p.tanggal_dibuat DESC
  `;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 4. Endpoint: Pengurus membalas pengaduan
app.post('/api/pengaduan/:id_pengaduan/tanggapan', (req, res) => {
  const { id_pengaduan } = req.params;
  const { status, tanggapan_pengurus } = req.body;
  
  const query = 'UPDATE pengaduan SET status = ?, tanggapan_pengurus = ? WHERE id_pengaduan = ?';
  db.query(query, [status, tanggapan_pengurus, id_pengaduan], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Tanggapan berhasil dikirim!' });
  });
});

// ==========================================
// FITUR PENGUMUMAN & REAKSI (EMOTE)
// ==========================================

// 1. Ambil semua pengumuman beserta kalkulasi jumlah emote
app.get('/api/pengumuman', (req, res) => {
  const query = `
    SELECT p.*,
      SUM(CASE WHEN r.emote = '👍' THEN 1 ELSE 0 END) as jempol,
      SUM(CASE WHEN r.emote = '❤️' THEN 1 ELSE 0 END) as hati,
      SUM(CASE WHEN r.emote = '😂' THEN 1 ELSE 0 END) as ketawa,
      SUM(CASE WHEN r.emote = '😢' THEN 1 ELSE 0 END) as sedih,
      SUM(CASE WHEN r.emote = '😡' THEN 1 ELSE 0 END) as marah
    FROM pengumuman p
    LEFT JOIN reaksi_pengumuman r ON p.id_pengumuman = r.id_pengumuman
    GROUP BY p.id_pengumuman
    ORDER BY p.tanggal_dibuat DESC
  `;
  db.query(query, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 2. Pengurus menambah pengumuman baru
app.post('/api/pengumuman', (req, res) => {
  db.query('INSERT INTO pengumuman (isi_pengumuman) VALUES (?)', [req.body.isi_pengumuman], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Pengumuman berhasil disebarkan!' });
  });
});

// 3. Pengurus mengedit pengumuman
app.put('/api/pengumuman/:id', (req, res) => {
  const query = 'UPDATE pengumuman SET isi_pengumuman = ? WHERE id_pengumuman = ?';
  db.query(query, [req.body.isi_pengumuman, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Pengumuman diperbarui!' });
  });
});

// 4. Pengurus menghapus pengumuman
app.delete('/api/pengumuman/:id', (req, res) => {
  db.query('DELETE FROM pengumuman WHERE id_pengumuman = ?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Pengumuman dihapus!' });
  });
});

// 5. Warga memberikan/mengubah reaksi emote
app.post('/api/pengumuman/:id/reaksi', (req, res) => {
  const { id_user, emote } = req.body;
  // Memasukkan reaksi baru
  const query = `
    INSERT INTO reaksi_pengumuman (id_pengumuman, id_user, emote) 
    VALUES (?, ?, ?) 
    ON DUPLICATE KEY UPDATE emote = ?
  `;
  db.query(query, [req.params.id, id_user, emote, emote], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Reaksi tersimpan!' });
  });
});

// Menjalankan server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});