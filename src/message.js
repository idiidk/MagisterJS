import _ from 'lodash'
import MagisterThing from './magisterThing'
import Person from './person'
import File from './file'
import { cleanHtmlContent, parseDate } from './util'

/**
 * @extends MagisterThing
 */
class Message extends MagisterThing {
	/**
	 * @param {Magister} magister
	 * @param {Object} [raw]
	 */
	constructor(magister, raw) {
		super(magister)

		/**
		 * @type Boolean
		 * @private
		 * @readonly
		 * @default true
		 */
		this._canSend = true
		/**
		 * @type Number
		 * @private
		 * @readonly
		 * @default 1
		 */
		this._type = 1
		/**
		 * @type String
		 * @readonly
		 * @default ''
		 */
		this.subject = ''
		/**
		 * @type String
		 * @readonly
		 * @default ''
		 */
		this.body = ''
		/**
		 * @type Person[]
		 * @readonly
		 * @default []
		 */
		this.recipients = []

		if (raw != null) {
			this._canSend = false
			this._type = raw.Soort
			this.subject = raw.Onderwerp
			this.body = cleanHtmlContent(raw.Inhoud) // REVIEW
			this.recipients = raw.Ontvangers.map(p => new Person(magister, p))

			/**
			 * @type String
			 * @readonly
			 */
			this.id = raw.Id.toString()
			/**
			 * @type String
			 * @readonly
			 */
			this.folderId = raw.MapId.toString()
			/**
			 * @type Person
			 * @readonly
			 */
			this.sender = new Person(magister, raw.Afzender)
			/**
			 * @type Date
			 * @readonly
			 */
			this.sendDate = parseDate(raw.VerstuurdOp)
			/**
			 * @type Date
			 * @readonly
			 */
			this.begin = parseDate(raw.Begin)
			/**
			 * @type Date
			 * @readonly
			 */
			this.end = parseDate(raw.Einde)
			/**
			 * @type Boolean
			 * @readonly
			 */
			this.isRead = raw.IsGelezen
			/**
			 * @type Number
			 * @readonly
			 */
			this.state = raw.Status
			/**
			 * @type Boolean
			 * @readonly
			 */
			this.isFlagged = raw.HeeftPrioriteit

			// REVIEW: do we want this comment?
			/**
			 * `this.fill()` required
			 * @type File[]
			 * @readonly
			 * @default undefined
			 */
			this.attachments = undefined

			/**
			 * @type String
			 * @private
			 * @readonly
			 */
			this._url = `${magister._personUrl}/berichten/${this.id}`
		}
	}

	/**
	 * @type String
	 * @readonly
	 * @default 'message'
	 */
	get type() {
		switch (this._type) {
		case 1:  return 'message'
		case 2:  return 'alert'
		default: return 'unknown'
		}
	}

	/**
	 * @param {Person|Person[]} recipients
	 */
	addRecipient(recipients) {
		if (!Array.isArray(recipients)) {
			recipients = [ recipients ]
		}

		if (!recipients.every(x => x instanceof Person)) {
			throw new Error('recipients should be a person or an persons array')
		}

		this.recipients = this.recipients.concat(recipients)
	}

	/**
	 * @param {Boolean} [fillPersons=false]
	 * @return {Promise<Message>}
	 */
	fill(fillPersons = false) {
		if (this._filled && (this._filledPersons || !fillPersons)) {
			return Promise.resolve(this)
		}

		const url = `${this._magister._personUrl}/berichten/${this.id}?berichtSoort=${this._type}`
		return this._magister.http.get(url)
		.then(res => res.json())
		.then(res => {
			this.body = cleanHtmlContent(res.Inhoud) // REVIEW
			this.attachments = (res.Bijlagen || []).map(a => new File(this._magister, undefined, a))

			if (fillPersons) {
				let promises = []

				promises.push(
					this.sender.getFilled()
					.then(r => this.sender = r)
					.catch(() => this.sender)
				)

				promises = promises.concat(
					this.recipients.map(r => {
						return r.getFilled()
						.then(x => x)
						.catch(() => r)
					})
				)

				return Promise.all(promises)
			}
		})
		.then(() => {
			this._filled = true
			return this
		})
	}

	// REVIEW
	move(destination) {
		if (_.isObject(destination)) {
			destination = destination.id
		}

		if (this.folderId === destination) {
			return Promise.resolve(undefined)
		}

		this.folderId = destination
		return this.saveChanges()
	}

	/**
	 * @return {Promise<Error|undefined>}
	 */
	remove() {
		return this._magister._privileges.needs('berichten', 'delete')
		.then(() => this._magister.http.delete(this._url))
	}

	/**
	 * Update the server to reflect the changes made on the properties of this
	 * Message instance.
	 * @return {Promise<undefined>}
	 */
	saveChanges() {
		return this._magister._privileges.needs('berichten', 'update')
		.then(() => this._magister.http.put(this._url, this._toMagister()))
		.then(() => undefined)
	}

	/**
	 * @return {Promise<Message>}
	 */
	send() {
		const reject = message => Promise.reject(new Error(message))

		if (!this._canSend) {
			return reject('message is marked as unsendable')
		} else if (this.recipients.length === 0) {
			return reject('message doesn\'t have recipients')
		} else if (this.subject.length === 0) {
			return reject('subject is empty')
		}

		return this._magister._privileges.needs('berichten', 'create')
		.then(() => this._magister.http.post(
			`${this._magister._personUrl}/berichten`,
			this._toMagister()
		))
		.then(() => this)
	}

	/**
	 * @private
	 * @return {Object}
	 */
	_toMagister() {
		const obj = {}

		obj.Id = this.id
		obj.Inhoud = this.body
		obj.MapId = this.folderId // number?
		obj.Onderwerp = this.subject
		obj.Ontvangers = this.recipients.map(p => p._toMagister())
		obj.VerstuurdOp = this.sendDate || new Date()
		obj.Begin = this.begin
		obj.Einde = this.end
		obj.IsGelezen = this.isRead
		obj.Status = this.state
		obj.HeeftPrioriteit = this.isFlagged
		obj.Soort = this._type

		return obj
	}
}

export default Message