const MasterLabTest = require('../../../models/MasterLabTest');
const MasterLabPackage = require('../../../models/MasterLabPackage');
const MasterRequest = require('../../../models/MasterRequest');
const xlsx = require('xlsx');
const LabCategory = require('../../../models/LabCategory');
const { deleteFile } = require('../../../utils/fileHandler');
const Medicine = require('../../../models/Medicine');

// --- 1. UPLOAD CSV / EXCEL (Optimized for 150MB+ Files & 8 Lakh Data) ---
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const MasterReportTemplate = require('../../../models/MasterReportTemplate'); 

// @desc    Upload Master Lab Tests via Excel/CSV (Automatically deletes temp file after DB import)
// @route   POST /admin/lab/tests/upload
// @access  Private (Admin)
const uploadMasterTests = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Upload Excel/CSV file" });

        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        const formattedData = data.map(item => ({
            testName: item.testName ? String(item.testName).trim() : "Diagnostic Test",
            testCode: item.testCode ? String(item.testCode).trim() : `TEST-${Date.now().toString().slice(-4)}`,
            mainCategory: item.mainCategory || 'Pathology',
            category: item.category || 'General Health',
            sampleType: item.sampleType || 'Blood',
            pretestPreparation: item.pretestPreparation || "No fasting required",
            standardMRP: item.standardMRP ? parseFloat(item.standardMRP) : 0,
            parameters: item.parameters ? item.parameters.split('||').map(s => s.trim()) : [],
            faqs: item.faqs ? item.faqs.split('||').map(pair => {
                const [q, a] = pair.split(':');
                return { question: q?.trim(), answer: a?.trim() };
            }) : [],
            detailedDescription: item.detailedDescription ? item.detailedDescription.split('||').map(pair => {
                const [title, content] = pair.split(':');
                return { sectionTitle: title?.trim(), sectionContent: content?.trim() };
            }) : []
        }));

        await MasterLabTest.insertMany(formattedData, { ordered: false });

        // Clean up temporary excel file from disk storage
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(200).json({ 
            success: true, 
            message: `Successfully processed and imported ${formattedData.length} Master Tests. Temporary file deleted.` 
        });
    } catch (error) { 
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("Upload Master Tests Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};

// @desc    Upload Master Lab Packages via Excel/CSV (Automatically deletes temp file after DB import)
// @route   POST /admin/lab/tests/upload-packages
// @access  Private (Admin)
const uploadMasterPackages = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Upload Excel/CSV file" });

        const workbook = xlsx.readFile(req.file.path);
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        let formattedData = [];

        for (let item of data) {
            let testIds = [];
            if (item.tests) {
                const testNamesArray = item.tests.split('||').map(t => t.trim());
                const foundTests = await MasterLabTest.find({ testName: { $in: testNamesArray } }).select('_id');
                testIds = foundTests.map(t => t._id);
            }

            formattedData.push({
                packageName: item.packageName ? String(item.packageName).trim() : "Master Health Package",
                shortDescription: item.shortDescription || "",
                longDescription: item.longDescription || "",
                mainCategory: item.mainCategory || 'Pathology',
                category: item.category || 'Full Body',
                reportTime: item.reportTime || "24 Hours",
                standardMRP: item.standardMRP ? parseFloat(item.standardMRP) : 0,
                tests: testIds,
                sampleTypes: item.sampleTypes ? item.sampleTypes.split('||').map(s => s.trim()) : ['Blood'],
                preparations: item.preparations ? item.preparations.split('||').map(p => p.trim()) : [],
                tags: item.tags ? item.tags.split('||').map(t => t.trim()) : [],
                lifestyleTags: item.lifestyleTags ? item.lifestyleTags.split('||').map(l => l.trim()) : [],
                isFastingRequired: item.isFastingRequired === 'TRUE' || item.isFastingRequired === true,
                fastingDuration: item.fastingDuration || "",
                gender: item.gender || 'Both',
                ageGroup: item.ageGroup || 'All',
                faqs: item.faqs ? item.faqs.split('||').map(pair => {
                    const [q, a] = pair.split(':');
                    return { question: q?.trim(), answer: a?.trim() };
                }) : [],
                detailedDescription: item.detailedDescription ? item.detailedDescription.split('||').map(pair => {
                    const [title, content] = pair.split(':');
                    return { sectionTitle: title?.trim(), sectionContent: content?.trim() };
                }) : []
            });
        }

        await MasterLabPackage.insertMany(formattedData, { ordered: false });

        // Clean up temporary excel file from disk storage
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(200).json({ 
            success: true, 
            message: `Successfully uploaded ${formattedData.length} Master Packages. Storage cleaned.` 
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        console.error("Upload Master Packages Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 1. LIST WITH PAGINATION (20 per page) || req.params => type: 'test' or 'package'
// endpoint: GET /admin/lab/tests/list/:type
const listMasterData = async (req, res) => {
    try {
        const { type } = req.params; // 'test' or 'package'
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        const total = await Model.countDocuments();
        
        // Initial query
        let query = Model.find().skip(skip).limit(limit).sort({ createdAt: -1 });

        // AGAR PACKAGE HAI TOH TESTS POPULATE KAREIN
        if (type === 'package') {
            query = query.populate('tests', 'testName sampleType mainCategory standardMRP'); 
            // 'tests' field ko populate kiya aur sirf kaam ke fields mangwaye
        }

        const data = await query;

        res.json({ success: true, total, page, totalPages: Math.ceil(total / limit), data });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};

// 2. SEARCH API (POST) || req.body => type: 'test' or 'package', query
// endpoint: POST /admin/lab/tests/search
const searchMasterData = async (req, res) => {
    try {
        const { type, query } = req.body;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        const searchRegex = new RegExp(query, 'i');

        const filter = type === 'test' ? { testName: searchRegex } : { packageName: searchRegex };
        const results = await Model.find(filter).limit(20);

        res.json({ success: true, data: results });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 3. MANUAL CREATE (Admin) || req.body => type: 'test' or 'package'
// endpoint: POST /admin/lab/tests/create
const createMasterData = async (req, res) => {
    try {
        const { type, payload } = req.body;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;
        
        const newData = await Model.create(payload);
        res.status(201).json({ success: true, data: newData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// 4. EDIT API (Admin) || req.params => type: 'test' or 'package', id
const editMasterData = async (req, res) => {
    try {
        const { type, id } = req.params;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;

        const updated = await Model.findByIdAndUpdate(id, req.body, { new: true });
        res.json({ success: true, data: updated });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

// ================= APPROVAL FLOW SECTION =================

// 5. GET ALL VENDOR REQUESTS (Pending - with Populated Test Details)
// endpoint: GET /admin/lab/tests/requests/pending
const getPendingRequests = async (req, res) => {
    try {
        const requests = await MasterRequest.find({ 
            status: 'Pending',
            vendorType: 'Lab'
        })
        .populate('vendorId', 'name email phone')
        .sort({ createdAt: -1 })
        .lean();

        // 1. Collect all test IDs from package requests
        const testIds = [];
        requests.forEach((reqItem) => {
            if (reqItem.requestType === 'Package' && Array.isArray(reqItem.data?.tests)) {
                testIds.push(...reqItem.data.tests);
            }
        });

        // 2. Fetch test details (name, code, mrp, sampleType, mainCategory)
        if (testIds.length > 0) {
            const testDocs = await MasterLabTest.find({ _id: { $in: testIds } })
                .select('testName testCode standardMRP sampleType mainCategory')
                .lean();

            const testMap = new Map();
            testDocs.forEach((t) => testMap.set(t._id.toString(), t));

            // 3. Populate test details into the tests array
            requests.forEach((reqItem) => {
                if (reqItem.requestType === 'Package' && Array.isArray(reqItem.data?.tests)) {
                    reqItem.data.tests = reqItem.data.tests.map(
                        (id) => testMap.get(id.toString()) || id
                    );
                }
            });
        }

        res.status(200).json({ success: true, count: requests.length, data: requests });
    } catch (error) { 
        console.error("getPendingRequests Error:", error);
        res.status(500).json({ success: false, message: error.message }); 
    }
};
// 6. APPROVE OR REJECT REQUEST
// endpoint: PUT /admin/lab/tests/requests/approve/:requestId
const approveRequest = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { status = 'Approved', adminComment = '' } = req.body;

        const request = await MasterRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        // If Admin decides to Reject
        if (status === 'Rejected') {
            request.status = 'Rejected';
            request.adminComment = adminComment || "Request rejected by admin.";
            await request.save();

            return res.status(200).json({ 
                success: true, 
                message: "Request rejected successfully",
                data: request 
            });
        }

        // If Admin Approves: Move data to official Master Collection
        const Model = request.requestType === 'Test' ? MasterLabTest : MasterLabPackage;
        await Model.create(request.data);

        // Update Request Status
        request.status = 'Approved';
        request.adminComment = adminComment || "Approved and imported to master catalog.";
        await request.save();

        res.status(200).json({ 
            success: true, 
            message: "Request approved and moved to Master list",
            data: request 
        });
    } catch (error) { 
        res.status(500).json({ success: false, message: error.message }); 
    }
};





// not in use
// endpoint: GET /admin/lab/tests/master-tests
const getMasterList = async (req, res) => {
    try {
        const { mainCategory, search } = req.query;
        let query = { isActive: true };
        if (mainCategory) query.mainCategory = mainCategory;
        if (search) query.testName = new RegExp(search, 'i');

        const list = await MasterLabTest.find(query);
        res.json({ success: true, data: list });
    } catch (error) { res.status(500).json({ message: error.message }); }
};
// GET MASTER PACKAGES LIST
// endpoint: GET /admin/lab/tests/master-packages
const getMasterPackages = async (req, res) => {
    try {
        const { category, search } = req.query;
        let query = { isActive: true };
        if (category) query.category = category;
        if (search) query.packageName = new RegExp(search, 'i');

        const list = await MasterLabPackage.find(query).populate('tests', 'testName sampleType');
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE MASTER DATA (Admin) || req.params => type: 'test' or 'package', id
const deleteMasterData = async (req, res) => {
    try {
        const { type, id } = req.params;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;

        const deleted = await Model.findByIdAndDelete(id);
        if (!deleted) {
            return res.status(404).json({ 
                success: false, 
                message: `${type === 'test' ? 'Test' : 'Package'} not found.` 
            });
        }
        res.json({ 
            success: true, 
            message: `${type === 'test' ? 'Test' : 'Package'} deleted successfully.` 
        });
    } catch (error) { 
        res.status(500).json({ message: error.message }); 
    }
};


// UPDATE CATEGORY IMAGE (Admin)
// endpoint: POST /admin/lab/tests/update-test-category-image
const updateCategoryImage = async (req, res) => {
    try {
        const { categoryName } = req.body;
        if (!req.file) return res.status(400).json({ message: "Please upload an image" });

        // 1. Check karein kya category pehle se exist karti hai
        let category = await LabCategory.findOne({ name: categoryName });

        if (category) {
            // Agar exist karti hai toh purani file delete karein
            if (category.image) deleteFile(category.image);
            
            category.image = req.file.path;
            await category.save();
        } else {
            // Agar nayi category hai toh create karein
            category = await LabCategory.create({
                name: categoryName,
                image: req.file.path
            });
        }

        res.json({ success: true, message: "Category image updated", data: category });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updatePharmacyCategoryImage = async (req, res) => {
    try {
        const { categoryName } = req.body;
        if (!req.file) return res.status(400).json({ message: "Upload an image" });

        let category = await LabCategory.findOne({ name: categoryName, vendorType: 'Pharmacy' });

        if (category) {
            if (category.image) deleteFile(category.image);
            category.image = req.file.path;
            await category.save();
        } else {
            category = await LabCategory.create({
                name: categoryName,
                image: req.file.path,
                vendorType: 'Pharmacy'
            });
        }

        res.json({ success: true, data: category });
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getLabCategories = async (req, res) => {
    try {
        // 1. Master tests se unique category names nikalen
        const womenCats = await MasterLabTest.distinct("category", {
            testName: { $regex: /Pap Smear|Mammography|FSH Test|LH Test|Prolactin|Ultrasound Pelvis/i },
            isActive: true
        });

        // 2. Database se images uthayen
        const dbCategories = await LabCategory.find({ name: { $in: womenCats } });

        // 3. Logic: Agar DB mein image hai toh 'public/' hatao, nahi toh fallback asset dikhao
        const finalData = womenCats.map(catName => {
            const dbMatch = dbCategories.find(dbCat => dbCat.name === catName);
            
            let imagePath;
            if (dbMatch && dbMatch.image) {
                // 'public/' ko string se remove karein
                imagePath = dbMatch.image.replace(/^public[\\/]/, ''); 
            } else {
                // Fallback asset path
                imagePath = `assets/images/women_${catName.toLowerCase().replace(" ", "_")}.png`;
            }

            return {
                name: catName,
                image: imagePath
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


// 2. Get All Pharmacy Categories (Including those without images)
const getPharmacyCategories = async (req, res) => {
    try {
        // Step 1: Medicine bread_crumb se Category nikalna
        const stats = await Medicine.aggregate([
            {
                $project: {
                    mainCat: { $trim: { input: { $arrayElemAt: [{ $split: ["$bread_crumb", ">"] }, 0] } } }
                }
            },
            { $match: { mainCat: { $ne: null, $ne: "" } } },
            { $group: { _id: "$mainCat", productCount: { $sum: 1 } } },
            { $sort: { productCount: -1 } }
        ]);

        const dbImages = await LabCategory.find({ vendorType: 'Pharmacy' });

        const finalData = stats.map(stat => {
            const dbMatch = dbImages.find(img => img.name === stat._id);
            return {
                name: stat._id,
                productCount: stat.productCount,
                image: dbMatch?.image ? dbMatch.image.replace(/^public[\\/]/, '') : null
            };
        });

        res.json({ success: true, data: finalData });
    } catch (error) { res.status(500).json({ message: error.message }); }
};







// 6. UPLOAD MASTER TEMPLATES VIA CSV
// POST: /api/admin/wallet/upload-templates-csv
// 1. BULK UPLOAD REPORT TEMPLATES VIA CSV
const uploadTemplatesCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Please upload a valid CSV/Excel file." });
        }

        // Parse CSV/Excel file safely
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

        const groups = {};

        data.forEach(row => {
            // Key normalization: trim and lower-case
            const normalizedRow = {};
            Object.keys(row).forEach(key => {
                const cleanKey = key.replace(/\r/g, '').trim().toLowerCase();
                normalizedRow[cleanKey] = row[key];
            });

            const testName = (normalizedRow['testname'] || "").trim();
            const parameterName = (normalizedRow['parametername'] || "").trim();
            
            // Resolve gender column from CSV (Male, Female, Both)
            let genderVal = (normalizedRow['gender'] || "Both").trim();
            if (!['Male', 'Female', 'Both'].includes(genderVal)) {
                // Capitalize first letter check (e.g., 'male' -> 'Male')
                genderVal = genderVal.charAt(0).toUpperCase() + genderVal.slice(1).toLowerCase();
                if (!['Male', 'Female', 'Both'].includes(genderVal)) {
                    genderVal = 'Both';
                }
            }

            // Grouping key combining testName and gender
            const groupKey = `${testName}___${genderVal}`;
            
            const interpretationKey = Object.keys(normalizedRow).find(k => k.includes('interpret'));
            const interpText = interpretationKey ? String(normalizedRow[interpretationKey] || "").trim() : "";

            if (!testName || !parameterName) return;

            if (!groups[groupKey]) {
                groups[groupKey] = {
                    testName: testName,
                    gender: genderVal,
                    parameters: []
                };
            }

            const isFirstParam = groups[groupKey].parameters.length === 0;

            groups[groupKey].parameters.push({
                name: parameterName,
                unit: normalizedRow['unit'] ? String(normalizedRow['unit']).trim() : "",
                minRef: normalizedRow['minref'] ? String(normalizedRow['minref']).trim() : "",
                maxRef: normalizedRow['maxref'] ? String(normalizedRow['maxref']).trim() : "",
                gender: genderVal,
                method: normalizedRow['method'] ? String(normalizedRow['method']).trim() : "N/A",
                machine: normalizedRow['machine'] ? String(normalizedRow['machine']).trim() : "Automated Analyzer",
                interpretation: isFirstParam ? interpText : ""
            });
        });

        // Bulk upsert grouped records into MongoDB
        for (const key of Object.keys(groups)) {
            const groupItem = groups[key];
            await MasterReportTemplate.findOneAndUpdate(
                { testName: groupItem.testName, gender: groupItem.gender },
                { 
                    $set: { 
                        testName: groupItem.testName,
                        gender: groupItem.gender,
                        parameters: groupItem.parameters 
                    } 
                },
                { upsert: true, new: true }
            );
        }

        // Clean up uploaded temporary file
        try {
            fs.unlinkSync(req.file.path);
        } catch (unlinkErr) {
            console.error("Temporary file delete failed:", unlinkErr.message);
        }

        res.json({
            success: true,
            message: `Successfully processed ${Object.keys(groups).length} test templates across genders. Database updated.`
        });

    } catch (error) {
        console.error("CSV Upload Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// 2. MANUAL CREATE REPORT TEMPLATE (Admin Panel)
const createReportTemplate = async (req, res) => {
    try {
        const { testName, gender, parameters, interpretation } = req.body;

        if (!testName || !parameters || !Array.isArray(parameters) || parameters.length === 0) {
            return res.status(400).json({ success: false, message: "testName and parameters array are required." });
        }

        const targetGender = gender || 'Both';

        const exists = await MasterReportTemplate.findOne({ testName, gender: targetGender });
        if (exists) {
            return res.status(400).json({ 
                success: false, 
                message: `A template for '${testName}' with gender '${targetGender}' already exists.` 
            });
        }

        // Map parameters with default interpretation on first param if provided
        const formattedParams = parameters.map((param, index) => ({
            ...param,
            interpretation: index === 0 ? (interpretation || param.interpretation || "") : (param.interpretation || "")
        }));

        const newTemplate = await MasterReportTemplate.create({ 
            testName, 
            gender: targetGender,
            parameters: formattedParams
        });
        
        res.status(201).json({ success: true, message: "Template created manually successfully", data: newTemplate });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 3. MANUAL EDIT REPORT TEMPLATE
const editReportTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { testName, gender, parameters, interpretation } = req.body;

        const updateData = {};
        if (testName) updateData.testName = testName.trim();
        if (gender) updateData.gender = gender;
        if (parameters && Array.isArray(parameters)) {
            updateData.parameters = parameters.map((param, index) => ({
                ...param,
                interpretation: index === 0 ? (interpretation || param.interpretation || "") : (param.interpretation || "")
            }));
        }

        const updated = await MasterReportTemplate.findByIdAndUpdate(id, { $set: updateData }, { new: true });
        
        if (!updated) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }
        res.json({ success: true, message: "Template updated successfully", data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 4. MANUAL DELETE REPORT TEMPLATE
const deleteReportTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await MasterReportTemplate.findByIdAndDelete(id);
        
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }
        res.json({ success: true, message: "Report template deleted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 7. GET: LIST ALL REPORT TEMPLATES (Admin Table View with Search, Gender Filter & Pagination)
// endpoint: GET /admin/lab/tests/report-templates?page=1&limit=20&gender=Female&search=CBC
const listReportTemplatesAdmin = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, gender } = req.query;

        let filter = {};
        if (search && search.trim() !== "") {
            filter.testName = { $regex: search.trim(), $options: 'i' };
        }
        if (gender && ['Male', 'Female', 'Both'].includes(gender)) {
            filter.gender = gender;
        }

        const total = await MasterReportTemplate.countDocuments(filter);
        const templates = await MasterReportTemplate.find(filter)
            .sort({ testName: 1, gender: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        res.json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            data: templates
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// 8. GET: FETCH SINGLE TEMPLATE DETAILS (For Admin Edit/Details Form with Gender Metadata)
// endpoint: GET /admin/lab/tests/report-templates/details/:id
const getReportTemplateDetailsAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        const template = await MasterReportTemplate.findById(id).lean();
        if (!template) {
            return res.status(404).json({ success: false, message: "Report template not found." });
        }

        res.json({
            success: true,
            data: {
                ...template,
                gender: template.gender || 'Both',
                totalParametersCount: template.parameters ? template.parameters.length : 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Get All Master Packages for Admin with Full Details, Test Population & Vendor Metrics
// @route   GET /admin/lab/tests/master-packages
// @access  Private (Admin)
const getMasterPackagesAdmin = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { search, category, mainCategory } = req.query;

        let matchQuery = {};
        if (search && search.trim() !== "") {
            matchQuery.packageName = new RegExp(search.trim(), 'i');
        }
        if (category && category.trim() !== "") {
            matchQuery.category = category.trim();
        }
        if (mainCategory && mainCategory.trim() !== "") {
            matchQuery.mainCategory = mainCategory.trim();
        }

        const aggregate = MasterLabPackage.aggregate([
            { $match: matchQuery },

            // 1. Lookup active lab vendor offerings for live vendorCount and minPrice
            {
                $lookup: {
                    from: "labpackages",
                    localField: "_id",
                    foreignField: "masterPackageId",
                    as: "vendorList",
                    pipeline: [{ $match: { isActive: true } }]
                }
            },

            // 2. Populate complete tests information (name, code, sampleType, parameters, MRP)
            {
                $lookup: {
                    from: "masterlabtests",
                    localField: "tests",
                    foreignField: "_id",
                    as: "testsData",
                    pipeline: [
                        {
                            $project: {
                                testName: 1,
                                testCode: 1,
                                sampleType: 1,
                                parameters: 1,
                                standardMRP: 1,
                                mainCategory: 1
                            }
                        }
                    ]
                }
            },

            // 3. Compute counts & metrics identical to user view
            {
                $addFields: {
                    vendorCount: { $size: "$vendorList" },
                    minPrice: {
                        $cond: {
                            if: { $gt: [{ $size: "$vendorList" }, 0] },
                            then: { $min: "$vendorList.offerPrice" },
                            else: null
                        }
                    },
                    testCount: { $size: "$tests" },
                    tests: "$testsData"
                }
            },

            // 4. Project clean schema
            {
                $project: {
                    vendorList: 0,
                    testsData: 0,
                    __v: 0
                }
            },
            { $sort: { createdAt: -1 } },

            // 5. 20 items per page pagination
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }]
                }
            }
        ]);

        const result = await aggregate;
        const total = result[0].metadata[0]?.total || 0;

        res.status(200).json({
            success: true,
            total,
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            limit,
            data: result[0].data
        });
    } catch (error) {
        console.error("getMasterPackagesAdmin Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Toggle Active/Inactive Status for Master Test or Package
// @route   PATCH /admin/lab/tests/toggle/:type/:id
// @access  Private (Admin)
const toggleMasterData = async (req, res) => {
    try {
        const { type, id } = req.params;
        const Model = type === 'test' ? MasterLabTest : MasterLabPackage;

        const item = await Model.findById(id);
        if (!item) {
            return res.status(404).json({ 
                success: false, 
                message: `${type === 'test' ? 'Test' : 'Package'} not found.` 
            });
        }

        item.isActive = !item.isActive;
        await item.save();

        res.status(200).json({
            success: true,
            message: `${type === 'test' ? 'Test' : 'Package'} is now ${item.isActive ? 'Active' : 'Inactive'}.`,
            data: {
                id: item._id,
                isActive: item.isActive
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



    
module.exports = { uploadMasterTests, getMasterList, uploadMasterPackages, getMasterPackagesAdmin,deleteMasterData,
                    listMasterData, searchMasterData, createMasterData, editMasterData,
                    getPendingRequests, approveRequest, updateCategoryImage, updatePharmacyCategoryImage,
                    getLabCategories, getPharmacyCategories,
                    listReportTemplatesAdmin, getReportTemplateDetailsAdmin,

                    uploadTemplatesCSV,createReportTemplate, editReportTemplate, deleteReportTemplate,getMasterPackages, toggleMasterData
 };